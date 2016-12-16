

module.exports = class{
        constructor(){

        }
        static run(id){
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                if(!Memory.operations[id].creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                    if(Game.spawns['Spawn1'].canCreateCreep([MOVE],undefined,{role: 'scout', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.spawns['Spawn1'].createCreep([MOVE],undefined,{role: 'scout', operation_id: id});
                        Memory.operations[id].creep=Game.creeps[name].id;
                    }
                }else if(!Game.getObjectById(Memory.operations[id].creep).spawning){ //IF CREEP FINISHED SPAWNING
                    var creep= Game.getObjectById(Memory.operations[id].creep);
                    creep.moveTo(Game.flags[Memory.operations[id].flagName], {reusePath: 30});
                    if(creep.room == Memory.operations[id].roomName){
                        Game.flags[Memory.operations[id].flagName].remove();

                    }

                }


            }
        }

        static init(roomName,flag,id = undefined){
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
