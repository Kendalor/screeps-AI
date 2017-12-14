const haulerBody = Array(20).fill(MOVE,0,10).fill(CARRY,10,20);
//const minerBody  = Array(50).fill(MOVE,0,25).fill(CARRY,25,30).fill(ATTACK,30,50);
const minerBody  = Array(50).fill(MOVE,0,25).fill(ATTACK,25,34).fill(CARRY,34,44).fill(HEAL,44,50);
const healerBody = Array(20).fill(MOVE,0,10).fill(HEAL,10,20);

module.exports = class{
        constructor(){

        }
        static run(id){
            if(Game.time%5){
                console.log("PP:" +id);
                console.log(JSON.stringify(Memory.operations[id].power));
                console.log(JSON.stringify(Memory.operations[id].miner));
            }
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
            // BUILD CREEPS UNTIL SQUAD SIZE REACHED
                var observer = Game.getObjectById(Memory.operations[id].observer);
                if(observer){
                    if(Memory.operations[id].power){
                        var flag = Game.flags[Memory.operations[id].flagName];
                        if(Game.time%50==6 || Game.time%50==7){
                            observer.observeRoom(Memory.operations[id].pRoom);
                            var powerBank = Game.getObjectById(Memory.operations[id].power);
                            if(powerBank && powerBank.power > 0 && powerBank.ticksToDecay > 500){
                                Memory.operations[id].active=1;
                            }else if(flag.room){
                                Memory.operations[id].active = undefined;
                                Memory.operations[id].power = undefined;
                            }
                        }
                        if(Memory.operations[id].active){
                            this.buildCreeps(id);
                            this.creepHandle(id,observer.room,flag);
                        }
                    }else{
                        //OBSERVE ROOMS
                        if(Memory.operations[id].rooms && Game.time%200<23){
                            var length = Memory.operations[id].rooms.length;
                            var idx = Game.time%length;
                            var room = Game.rooms[Memory.operations[id].rooms[idx]];
                            if(room){
                                var pB = room.powerBank;
                                if(pB){
                                    Memory.operations[id].power = pB.id;
                                    Memory.operations[id].pRoom = Memory.operations[id].rooms[idx];
                                    Game.flags[Memory.operations[id].flagName].setPosition(pB.pos);
                                    observer.observeRoom(Memory.operations[id].pRoom);
                                }
                            }else{
                                idx = idx < (length-1)? idx+1:0;
                                observer.observeRoom(Memory.operations[id].rooms[idx]);
                            }
                            
                        }else{
                            //Calculate Rooms to check.
                            Memory.operations[id].rooms=[];
                            var coords = observer.room.coords;
                            var xLowerHighway = parseInt(coords.x/10)*10;
                            var xUpperHighway = xLowerHighway+10;
                            var yLowerHighway = parseInt(coords.y/10)*10;
                            var yUpperHighway = yLowerHighway+10;
                            var lowerX = coords.x%10 < 5;
                            var upperX = coords.x%10 > 5;
                            var lowerY = coords.y%10 < 5;
                            var upperY = coords.y%10 > 5;
                            var i;
                            if(lowerX){
                                for(i=0;i<=10;i++){
                                    Memory.operations[id].rooms.push(coords.xId+xLowerHighway+coords.yId+(yLowerHighway+i));
                                }
                            }else if(upperX){
                                for(i=0;i<=10;i++){
                                    Memory.operations[id].rooms.push(coords.xId+xUpperHighway+coords.yId+(yLowerHighway+i));
                                }
                            }
                            
                            if(lowerY){
                                for(i=0;i<=10;i++){
                                    Memory.operations[id].rooms.push(coords.xId+(xLowerHighway+i)+coords.yId+yLowerHighway);
                                }
                            }else if(upperY){
                                for(i=0;i<=10;i++){
                                    Memory.operations[id].rooms.push(coords.xId+(xLowerHighway+i)+coords.yId+yUpperHighway);
                                }
                            }
                        }
                    }
                }
            }
        }

        static creepHandle(id,homeRoom,flag){
            if(Memory.operations[id].miner){
                var creep = Game.creeps[Memory.operations[id].miner];
                if(creep){
                    switch(creep.room.name){
                        case homeRoom.name:
                            if(creep.carry.power){
                                var powerSpawn = creep.room.powerSpawn;
                                if(creep.inRangeTo(powerSpawn,1)){
                                    creep.transfer(powerSpawn,RESOURCE_POWER);
                                    if(powerSpawn.power == powerSpawn.powerCapacity){
                                        powerSpawn.createPowerCreep("Alice");
                                        //powerSpawn.processPower();
                                    }
                                }else{
                                    creep.travelTo(powerSpawn);
                                }
                            }else{
                                creep.journeyTo(flag);
                            }
                            if(creep.hits<creep.hitsMax){
                                creep.heal(creep);
                            }
                            break;
                        case flag.pos.roomName:
                            if(creep.carry.power == creep.carryCapacity){
                                creep.moveTo(homeRoom.powerSpawn);
                            }else{
                                var powerBank = creep.room.powerBank;
                                if(powerBank){
                                    if(creep.inRangeTo(powerBank,1)){
                                        creep.attack(powerBank);
                                    }else{
                                        creep.moveTo(powerBank)
                                    }
                                    if(creep.hits<creep.hitsMax-60){
                                        creep.heal(creep);
                                    }
                                }else{
                                    creep.moveTo(flag);
                                }
                            }
                            break;
                        default:
                            if(creep.carry.power > 0){
                                creep.creep.travelTo(homeRoom.powerSpawn);
                            }else{
                                creep.travelTo(flag);
                                //creep.creep.journeyTo(homeRoom.powerSpawn);
                            }
                            if(creep.hits<creep.hitsMax){
                                creep.heal(creep);
                            }
                    }
                }
            }
        }
        
        static buildCreeps(id){
            let spawnList=Memory.operations[id].spawnList;
            if(!Memory.operations[id].miner)
                Memory.operations[id].miner = this.creepBuilder(spawnList,minerBody,{role: 'powerMiner', operation: id});
            /*
            if(!Memory.operations[id].healer)
                Memory.operations[id].healer = this.creepBuilder(spawnList,minerBody,{role: 'powerHealer', operation: id});
            if(!Memory.operations[id].hauler)
                Memory.operations[id].hauler = this.creepBuilder(spawnList,minerBody,{role: 'powerHauler', operation: id});
            */
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
                Memory.operations[this.id].type='power';
                Memory.operations[this.id].active=true;
                Memory.operations[this.id].spawnList=this.findClosestSpawn(roomName,1);
                Memory.operations[this.id].observer=Game.spawns[Memory.operations[this.id].spawnList[0]].room.observer.id;
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

        static creepBuilder(spawnList,body,memory){
            for(var i in spawnList){
                var spawn=Game.spawns[spawnList[i]];
                if(spawn.spawning == null && spawn.inactive == undefined){
                    if(spawn.canSpawnCreep(body, undefined, memory) == OK){
                        return spawn.spawnCreep(body,undefined,memory);
                    }
                }
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

};
