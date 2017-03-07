var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true,'dragoonreas' : true,'KermitFrog' : true};

module.exports = class{
        constructor(){

        }
        static run(id){

            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED

            if(Object.keys(Memory.operations[id].members).length < Memory.operations[id].size && !Memory.operations[id].members.assembled){
                var spawn = Game.getObjectById(Memory.operations[id].nearestSpawnId);
                var body = Memory.operations[id].default_body;
                if(spawn.canSpawnCreep(body, undefined, {role: 'ranged_attack', operation: id, target: Memory.operations[id].flagName}) == OK){
                    var name=spawn.spawnCreep(body,undefined,{role: 'ranged_attack', operation_id: id, target: Memory.operations[id].flagName});
                    Memory.operations[id].members[name]= 'tank';
                    console.log('Did spawn creep '+name);
                }
            }
            for(var i in Memory.operations[id].members){
                if(!Game.creeps[i]){
                    console.log('Deleted '+i +' from memory')
                    delete Memory.creeps[i];
                    delete Memory.operations[id].members[i];
                }else if(!Game.creeps[i].spawning){
                    var creep=Game.creeps[i];
                    this.creepHandle(creep,id);
                }
            }



            }
        }

        static creepHandle(creep,id){
            var flag=Game.flags[Memory.operations[id].flagName];
            var home=Game.getObjectById(Memory.operations[id].nearestSpawnId);
            if(creep.room.name != flag.pos.roomName){
                creep.moveTo(Game.flags[Memory.operations[id].flagName]);
            }else{
                creep.moveTo(flag);
                var target=creep.pos.findInRange(FIND_HOSTILE_CREEPS,3,{filter: (hostile) => WHITELIST[hostile.owner.username] == undefined });
                if(target.length >0){
                    console.log(target);
                    creep.rangedAttack(target[0]);
                }
            }
        }

        static findClosestSpawn(flagName){
            var min_length;
            var best_spawn;
            var length;
            for(var i in Game.spawns){
                console.log('length from '+Game.spawns[i].pos.roomName+' to '+Game.flags[flagName].pos.roomName);
                console.log( Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length < min_length  || min_length == undefined);
                length= Object.keys(Game.map.findRoute(Game.spawns[i].pos.roomName,Game.flags[flagName].pos.roomName)).length;
                if(length < min_length  || min_length == undefined){
                    min_length=length;
                    best_spawn=Game.spawns[i].id;
                }
            }
            return best_spawn;
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
                Memory.operations[this.id].type='ranged_attack';
                Memory.operations[this.id].size=1;
                Memory.operations[this.id].members= {};
                Memory.operations[this.id].nearestSpawnId=Game.spawns['Spawn3'].id;
                //Memory.operations[this.id].default_body=Array(50).fill(TOUGH,0,15).fill(MOVE,15,40).fill(RANGED_ATTACK,40,50);
				Memory.operations[this.id].default_body=Array(10).fill(MOVE,0,5).fill(RANGED_ATTACK,5,10); // 1000


                //console.log(JSON.stringify(Memory.operations[this.id]));
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
        // IDLE MOVESET






};
