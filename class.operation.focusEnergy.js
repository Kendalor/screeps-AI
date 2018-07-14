var MIN_STORED_ENERGY = 200000;

module.exports = class{
        constructor(){
        }
        static run(id){
            if(!Memory.operations[id].pause){
                // DELETE NONEXISTING CREEPS FROM OPERATION
                if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                    for(var i in Memory.operations[id].rooms){
                        if(Game.rooms[i]){
                            var room=Game.rooms[i];
                            this.buildAndRunCreeps(id,room);
                        }
                        if(Memory.operations[id].rooms[i].type == 'focus'){
                            var room_focus=i;
                        }
                    }
                    for(var i in Memory.operations[id].rooms){
                        if(Game.rooms[i]){
                            var room=Game.rooms[i];
                            if(Memory.operations[id].rooms[i].type == 'supply'){
                                if(room.terminal.store[RESOURCE_ENERGY]>5000 && _.sum(Game.rooms[room_focus].terminal.store)<room.terminal.storeCapacity-5000){
                                    room.terminal.send(RESOURCE_ENERGY,room.terminal.store[RESOURCE_ENERGY]/2,room_focus);
                                }
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
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;

                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                //DEFINE ALL OP VARIABLES HERE
                //Memory.operations[this.id].containerId=undefined;
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                Memory.operations[this.id].permanent=false;
                Memory.operations[this.id].type='focusEnergy';
                console.log(!Game.rooms[roomName])
                Memory.operations[this.id].status='default';
                Memory.operations[this.id].targetRoom=Game.flags[flag].pos.roomName;
                Memory.operations[this.id].rooms={};
                Memory.operations[this.id].hauler_body=[CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE];

                for(var i in Game.rooms){
                    if(Game.rooms[i].terminal != undefined && Game.rooms[i].terminal != undefined && i != Memory.operations[this.id].targetRoom 
					&& Game.map.getRoomLinearDistance(Memory.operations[this.id].targetRoom,i, true)<=4){
                        if(i == Memory.operations[this.id].targetRoom){
                            Memory.operations[this.id].rooms[i]={};
                            Memory.operations[this.id].rooms[i].type='focus'
                        }else{
                            Memory.operations[this.id].rooms[i]={};
                            Memory.operations[this.id].rooms[i].type='supply'
                        }
                    }
                }
                if(!Memory.operations[this.id].rooms[Memory.operations[this.id].targetRoom]){
                            Memory.operations[this.id].rooms[Memory.operations[this.id].targetRoom]={};
                            Memory.operations[this.id].rooms[Memory.operations[this.id].targetRoom].type='focus'
                }
                console.log('Created New Operation');
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


        //BUILD CREEPS
        static buildAndRunCreeps(id,room){
            var body= Memory.operations[id].hauler_body;
            var spawn = room.find(FIND_MY_SPAWNS)[0];
            if(!Memory.operations[id].rooms[room.name].hauler){
                if(spawn.canSpawnCreep(body,undefined,{role: 'focusEnergy', operation_id: id, storage_id: room.storage.id , terminal_id: room.terminal.id, room_type: Memory.operations[id].rooms[room.name].type}) == OK){// NO SPAWN IT IF POSSIBLE !
                    var name=spawn.spawnCreep(body,undefined,{role: 'focusEnergy', operation_id: id, storage_id: room.storage.id , terminal_id: room.terminal.id, room_type: Memory.operations[id].rooms[room.name].type});
                    Memory.operations[id].rooms[room.name].hauler=name;
                }
            }else if(!Game.creeps[Memory.operations[id].rooms[room.name].hauler]){
                console.log('Deleted '+Memory.operations[id].rooms[room.name].hauler +' from memory')
                delete Memory.creeps[Memory.operations[id].rooms[room.name].hauler];
                delete Memory.operations[id].rooms[room.name].hauler;
            }else if(!Game.creeps[Memory.operations[id].rooms[room.name].hauler].spawning){
                var creep=Game.creeps[Memory.operations[id].rooms[room.name].hauler];
                this.creepHandle(creep,id,room);
            }
        }

        static creepHandle(creep){
            var storage=Game.getObjectById(creep.memory.storage_id);
            var terminal=Game.getObjectById(creep.memory.terminal_id);
            if(creep.memory.room_type == 'focus'){
                this.creepFocus(creep,storage,terminal);
            }else{
                this.creepSupply(creep,storage,terminal);
            }

        }

        static creepFocus(creep,storage,terminal){
            creep.say('focus');
            if(creep.carry.energy == 0 && terminal.store[RESOURCE_ENERGY] > 5000){
                var err=creep.withdraw(terminal,RESOURCE_ENERGY);
                if(err == ERR_NOT_IN_RANGE){
                    creep.moveTo(terminal);
                }
            }else{
                var err=creep.transfer(storage,RESOURCE_ENERGY);
                if(err == ERR_NOT_IN_RANGE){
                    creep.moveTo(storage);
                }
            }
        }

        static creepSupply(creep,storage,terminal){
            creep.say('Supply');
            if(creep.carry.energy == 0 && storage.store[RESOURCE_ENERGY] > MIN_STORED_ENERGY){
                var err=creep.withdraw(storage,RESOURCE_ENERGY);
                if(err == ERR_NOT_IN_RANGE){
                    creep.moveTo(storage);
                }
            }else{
                var err=creep.transfer(terminal,RESOURCE_ENERGY);
                if(err == ERR_NOT_IN_RANGE){
                    creep.moveTo(terminal);
                }
            }
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
