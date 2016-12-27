

module.exports = class{
        constructor(){
        }
        static run(id){
            // DELETE NONEXISTING CREEPS FROM OPERATION
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                if(Memory.operations[id].scouting){
                    this.scouting(id);
                }else{
                    switch (Memory.operations[id].status) {
                        case 'createConstructionSites':
                            this.buildRoadAndContainer(id);
                            break;

                        case 'Mining':
                            //PALLES FUNKTION HIER
                            break;


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
                Memory.operations[this.id].type='remote_mining';
                console.log(!Game.rooms[roomName])
                if(!Game.rooms[roomName]){
                    Memory.operations[this.id].scouting=true;
                    Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                    Memory.operations[this.id].nearest_storageId=Game.getObjectById(Memory.operations[this.id].nearest_spawnId).room.storage.id;
                    Memory.operations[this.id].roadsBuild=false;
                    Memory.operations[this.id].status='createConstructionSites';


                }else{
                    Memory.operations[this.id].scouting=false;
                    Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                    Memory.operations[this.id].nearest_storageId=Game.getObjectById(Memory.operations[this.id].nearest_spawnId).room.storage.id;
                    Memory.operations[this.id].roadsBuild=false;
                    Memory.operations[this.id].status='createConstructionSites';
                }


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


        //FIND CLOSEST ACROOS ROOMS
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

        static buildRoadAndContainer(id){
            if(!Memory.operations[id].sources){//If this room has no sources memory yet
                Memory.operations[id].sources = {}; //Add it
                var room= Game.rooms[Memory.operations[id].roomName];
                var sources = room.find(FIND_SOURCES);//Find all sources in the current room
                for(var i in sources){
                    var source = sources[i];
                    source.memory = Memory.operations[id].sources[source.id] = {}; //Create a new empty memory object for this source
                }
            }else{
                 // BUILD CONTAINER AND RPAD

                var sources = Memory.operations[id].sources;
                var done = true;
                for(var s_id in sources){
                    console.log(s_id);
                    var source=Game.getObjectById(s_id);
                    console.log(source);
                    var storage=Game.getObjectById(Memory.operations[id].nearest_storageId);

                    console.log('Start');
                    var roomList=Game.map.findRoute(storage.pos.roomName,source.pos.roomName);
                    var lastPos={};
                    var path=storage.pos.findPathTo(source,{ignoreCreeps: true});
                    for(var i in path){
                        if(i == path.length-1 ){
                            if(path[i].x == 0){
                                lastPos.x=49;
                                lastPos.y=path[i].y;
                            }else if(path[i].x == 49){
                                lastPos.x=0;
                                lastPos.y=path[i].y;
                            }else if(path[i].y == 0){
                                lastPos.y=49;
                                lastPos.x=path[i].x;
                            }else if(path[i].y == 49){
                                lastPos.y=0;
                                lastPos.x=path[i].x;
                            }
                        }else{
                            console.log('create Road');
                            console.log(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                            if(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != ERR_INVALID_TARGET){
                                done=false;
                            }
                        }
                    }

                    for(var j in roomList){
                        if(roomList[j].room == source.pos.roomName){
                            var path=source.pos.findPathTo(new RoomPosition(lastPos.x,lastPos.y,source.pos.roomName),{ignoreCreeps: true});
                            for(var i in path){
                                if(i==0){
                                console.log('create Container');
                                console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER));
                                Memory.operations[id].sources[s_id].containerPos = {};
                                Memory.operations[id].sources[s_id].containerPos.x = path[0].x;
                                Memory.operations[id].sources[s_id].containerPos.y = path[0].y;
                                if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER) != ERR_INVALID_TARGET){
                                    done=false;
                                }
                                }else{
                                    console.log('create Road');
                                    console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                                    if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != ERR_INVALID_TARGET){
                                        done=false;
                                    }
                                }
                            }
                        }else{
                            path=new RoomPostition(lastPos.x,lastPos.y,roomList[j].room).findPathTo(source,{ignoreCreeps: true})
                            for(var i in path){
                                if(i == path.length-1 ){
                                    if(path[i].x == 0){
                                        lastPos.x=49;
                                        lastPos.y=path[i].y;
                                    }else if(path[i].x == 49){
                                        lastPos.x=0;
                                        lastPos.y=path[i].y;
                                    }else if(path[i].y == 0){
                                        lastPos.y=49;
                                        lastPos.x=path[i].x;
                                    }else if(path[i].y == 49){
                                        lastPos.y=0;
                                        lastPos.x=path[i].x;
                                    }
                                }else{
                                    console.log('create Road');
                                    console.log(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                                    if(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != ERR_INVALID_TARGET){
                                        done=false;
                                    }
                                }
                            }
                        }

                    }

                    /*
                    console.log(JSON.stringify(lastPos));
                    var path=source.pos.findPathTo(new RoomPosition(lastPos.x,lastPos.y,source.pos.roomName),{ignoreCreeps: true});
                    for(var i in path){
                        if(i==0){
                            console.log('create Container');
                            console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER));
                            Memory.operations[id].sources[s_id].containerPos = {};
                            Memory.operations[id].sources[s_id].containerPos.x = path[0].x;
                            Memory.operations[id].sources[s_id].containerPos.y = path[0].y;
                            if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER) != ERR_INVALID_TARGET){
                                done=false;
                            }
                        }else{
                            console.log('create Road');
                            console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                            if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != ERR_INVALID_TARGET){
                                done=false;
                            }
                        }
                    }*/

                }
            }
            if(done){
                Memory.operations[id].status='building';
            }





        }

        static scouting(id){
            if(!Memory.operations[id].s_creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([MOVE],undefined,{role: 'scout', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([MOVE],undefined,{role: 'scout', operation_id: id});
                    var creep=Game.creeps[name];
                    Memory.operations[id].s_creep=name;
                }
                }else if(!Game.creeps[Memory.operations[id].s_creep].spawning){ //IF CREEP FINISHED SPAWNING
                    var creep= Game.creeps[Memory.operations[id].s_creep];
                    creep.moveTo(Game.flags[Memory.operations[id].flagName], {reusePath: 30});
                    creep.say('scouting');
                    if(creep.room.name == Memory.operations[id].roomName){
                        Memory.operations[id].scouting=false;
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
