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
            // tank
            //var creep_body = [MOVE,MOVE,MOVE,MOVE,MOVE,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH,TOUGH];
            // scout
            var creep_body = [MOVE];
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                if(!Memory.operations[id].creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                    if(Game.spawns['Spawn1'].canCreateCreep(creep_body,undefined,{role: 'scout', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.spawns['Spawn1'].createCreep(creep_body,undefined,{role: 'scout', operation_id: id});
                        var creep=Game.creeps[name];
                        Memory.operations[id].creep=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].creep]){
                    delete Memory.operations[id].creep;

                }else if(!Game.creeps[Memory.operations[id].creep].spawning){ //IF CREEP FINISHED SPAWNING
                
                    var creep= Game.creeps[Memory.operations[id].creep];
					//if (!creep.clearSign()){
					if (!creep.makeScreepsPinkAgain()){
						creep.moveTo(Game.flags[Memory.operations[id].flagName], {reusePath: 30});
					}
                    if(creep.room.pos == Game.flags[Memory.operations[id].flagName].pos){
                        //Game.flags[Memory.operations[id].flagName].remove();
                    }
                }
            }
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
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='scouting';
                console.log(JSON.stringify(Memory.operations[this.id]));
            }
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
