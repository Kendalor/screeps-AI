/*
TODO:
1) implement "find Closest Spawn" form other operations  and use it in initialisation and Build creep phase
2) Use members and size parameter to modularize operations -> use function creepBuilder in operation.defend_keeper
3) Use PathFinder for long distance Travel !!!  ( Patfinder.search .. ) Mix uses of Game.map.findRoute and Pathfinder.search
4) Modify  "findClosestSpawn" to return an array of spawns, to handle multi spawn rooms, and spawns with same distance to Target -> DONE  look in operation.defend_keeper
5) modify creep building to handle a spawnlist
6) implement "BuildCreeps" which handels building creeps on different operations ( for later prototype use).
    IN: Spawnlist ( List (array) of spawns (names, or ids) to use)
        Members list ( a List to check its length and to save spawned creeps into)
        body ( a body type to spawn)
        mem ( variables to write to creep memory)
*/

module.exports = class{
        constructor(){
        }
        static run(id){
			
		}
		static creepHandle(creep,id){
			
		}
		static buildCreeps(id){
            
        }
        static init(roomName,flag){
            if(!Game.flags[flag].memory.operation_id){
                if(!Memory.operations){
                        Memory.operations={};
                }
                this.id=parseInt(Math.random()*10000000);
                console.log(this.isIdFree(this.id));
                while(!this.isIdFree(this.id)){
                    this.id=parseInt(Math.random()*10000000);
                }

                this.roomName=roomName;
                console.log(flag);
                console.log(this.id);
                console.log(this.roomName);
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;

                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                //DEFINE ALL OP VARIABLES HERE
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                Memory.operations[this.id].flagPos= Game.flags[flag].pos;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='scouting';
                Memory.operations[this.id].size=1;
				Memory.operations[this.id].default_Abody=Array(1).fill(MOVE,0,1);// COST 50
                Memory.operations[this.id].SpawnList=this.findClosestSpawn(roomName);
                Memory.operations[this.id].members={};


                //console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }
		
// DONT
// MODIFY
// FUNCTIONS
// BELOW HERE
// THEY ARE FOR  FUTURE PROTOTYPES


        static findClosestSpawn(targetRoomName,addDistance=0){
            var min_dist=999;
            var spawnList=[];
            for(var i in Memory.myRooms){
                if(min_dist > Object.keys(Game.map.findRoute(targetRoomName,i)).length){
                    min_dist=Object.keys(Game.map.findRoute(targetRoomName,i)).length;
                }
            }
            min_dist +=addDistance;
            for(var j in Game.spawns){
                let dist=Object.keys(Game.map.findRoute(targetRoomName,Game.spawns[j].pos.roomName)).length;;
                if(min_dist >= Object.keys(Game.map.findRoute(Game.spawns[j].pos.roomName,targetRoomName)).length){
                    spawnList.push(j);
                }
            }
            return spawnList;
        }

        static creepBuilder(spawnList,memberList,size,body,memory){
            var out=memberList;
            if(Object.keys(out).length < size){
                for(var i in spawnList){
                    var spawn=Game.spawns[spawnList[i]];
                    if(spawn.spawning == null){
                        if(Object.keys(out).length < size){
                            if(spawn.canCreateCreep(body, undefined, memory) == OK){
                                var name=spawn.createCreep(body,undefined,memory);
                                out[name]= {};
                            }
                        }
                    }
                }
            }
            return out;
        }

        static cleanUpCreeps(members){
            var temp=members;
            for(var i in temp){
                if(!Game.creeps[i]){
                    delete temp[i];
                }
            }
            return temp;
        }

        // CHECK IF ID IS AVAILABLE
        static isIdFree(id){
            var out=true;
            for(var i in Memory.operations){
                if(Memory.operations[id]){
                    out= false;
                }

            }
            return out;
        }
        // CHECK IF FLAG IS STILL EXISITING, IF NOT => DELETE OPERATION IF NOT PERMANENT
        static checkForDelete(id){
            var flagname =  Memory.operations[id].flagName;
            if(!Game.flags[flagname] && !Memory.operations[id].permanent){
                delete Memory.flags[flagname];
                delete Memory.operations[id];

                return true;
            }else {
                return false;
            }
        }
};
