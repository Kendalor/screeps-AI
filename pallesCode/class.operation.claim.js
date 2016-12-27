

module.exports = class{
        constructor(){
        }
        static run(id){
            // DELETE NONEXISTING CREEPS FROM OPERATION
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE

                if(!Memory.operations[id].creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                    if(Game.spawns['Spawn1'].canCreateCreep([CLAIM,MOVE],undefined,{role: 'claim', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.spawns['Spawn1'].createCreep([CLAIM,MOVE],undefined,{role: 'claim', operation_id: id});
                        var creep=Game.creeps[name];
                        Memory.operations[id].creep=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].creep]){
                    console.log('Deleted '+Memory.operations[id].creep +'from memory')
                    delete Memory.creeps[Memory.operations[id].creep];
                    delete Memory.operations[id].creep;
                }else if(!Game.creeps[Memory.operations[id].creep].spawning){ //IF CREEP FINISHED SPAWNING
                    var creep= Game.creeps[Memory.operations[id].creep];

                    if(creep.room.name != Memory.operations[id].roomName){
                        creep.moveTo(Game.flags[Memory.operations[id].flagName], {reusePath: 30});
                        creep.say('Traveling to Room');
                    }else if(creep.room.name == Memory.operations[id].roomName){
                        if(!Memory.operations[id].controller_id){
                            Memory.operations[id].controller_id=Game.rooms[Memory.operations[id].roomName].controller.id;
                        }else{
                            if(creep.claimController(Game.getObjectById(Memory.operations[id].controller_id)) == ERR_NOT_IN_RANGE){
                            creep.moveTo(Game.getObjectById(Memory.operations[id].controller_id));
                            creep.say('Claim');

                            }

                        }

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
                Memory.operations[this.id].type='claim';
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
