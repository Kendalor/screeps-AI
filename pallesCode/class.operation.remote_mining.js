

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
                        case 'BuildingContainer':
                            this.buildAndRunMiner(id);
                            break;
                        case 'buildingRoad':
                            break;
                        case 'Mining':
                            //PALLES FUNKTION HIER
                            //CREEP SPAWNING
                            this.buildAndRunCreeps(id);
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
                //Memory.operations[this.id].containerId=undefined;
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
                    Memory.operations[this.id].constructionSites={};

                }else{
                    Memory.operations[this.id].scouting=false;
                    Memory.operations[this.id].nearest_spawnId=this.findClosestSpawn(flag);
                    Memory.operations[this.id].nearest_storageId=Game.getObjectById(Memory.operations[this.id].nearest_spawnId).room.storage.id;
                    Memory.operations[this.id].roadsBuild=false;
                    Memory.operations[this.id].status='createConstructionSites';
                    Memory.operations[this.id].constructionSites={};
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
        // BUILD CREEPS FOR HAULING AND MINING
        static buildAndRunMiner(id){
            for(var i in Memory.operations[id].sources){
                // MINER CODE
                if(!Memory.operations[id].sources[i].miner){ //DOES THIS SOURCE HAVE A MINER
                    // 7x WORK ( to make up for the walking distance ) , 1 CARRY,and 7 MOVE to assure walk speed = 1/tick COST = 1150
                    if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i});
                        Memory.operations[id].sources[i].miner=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner]){
                    console.log('Deleted '+Memory.operations[id].sources[i].miner +' from memory')
                    delete Memory.creeps[Memory.operations[id].sources[i].miner];
                    delete Memory.operations[id].sources[i].miner;
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner].spawning){
                    this.creepMine(Game.creeps[Memory.operations[id].sources[i].miner]);

                }
            }
        }

        static buildAndRunHauler(id){
            for(var i in Memory.operations[id].sources){
                // HAULER CODE
                if(!Memory.operations[id].sources[i].hauler){ //DOES THIS SOURCE HAVE A MINER
                    // 1x WORK, 18 CARRY = 900 capacity, 10 MOVE = 1tile/tick on roads if full COST= 2000
                    if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'hauling', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'hauling', operation_id: id, source_id: i});
                        Memory.operations[id].sources[i].hauler=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].sources[i].hauler]){
                    console.log('Deleted '+Memory.operations[id].sources[i].hauler +' from memory')
                    delete Memory.creeps[Memory.operations[id].sources[i].hauler];
                    delete Memory.operations[id].sources[i].hauler;
                }else if(!Game.creeps[Memory.operations[id].sources[i].hauler].spawning){
                    this.creepHaul(Game.creeps[Memory.operations[id].sources[i].hauler]);

                }

            }
        }

        static buildAndRunBuilder(id){
            if(Object.keys(Memory.operations[id].constructionSites).length >0){


            }else{
                Memory.operations[id].status='Mining';
            }

        }

        static buildAndRunCreeps(id){
            // ITERATE OVER SOURCES
            for(var i in Memory.operations[id].sources){
                // MINER CODE
                if(!Memory.operations[id].sources[i].miner){ //DOES THIS SOURCE HAVE A MINER
                    // 7x WORK ( to make up for the walking distance ) , 1 CARRY,and 7 MOVE to assure walk speed = 1/tick COST = 1150
                    if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i});
                        Memory.operations[id].sources[i].miner=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner]){
                    console.log('Deleted '+Memory.operations[id].sources[i].miner +' from memory')
                    delete Memory.creeps[Memory.operations[id].sources[i].miner];
                    delete Memory.operations[id].sources[i].miner;
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner].spawning){
                    this.creepMine(Game.creeps[Memory.operations[id].sources[i].miner]);

                }
                // HAULER CODE
                if(!Memory.operations[id].sources[i].hauler){ //DOES THIS SOURCE HAVE A MINER
                    // 1x WORK, 18 CARRY = 900 capacity, 10 MOVE = 1tile/tick on roads if full COST= 2000
                    if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'hauling', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'hauling', operation_id: id, source_id: i});
                        Memory.operations[id].sources[i].hauler=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].sources[i].hauler]){
                    console.log('Deleted '+Memory.operations[id].sources[i].hauler +' from memory')
                    delete Memory.creeps[Memory.operations[id].sources[i].hauler];
                    delete Memory.operations[id].sources[i].hauler;
                }else if(!Game.creeps[Memory.operations[id].sources[i].hauler].spawning){
                    this.creepHaul(Game.creeps[Memory.operations[id].sources[i].hauler]);

                }

            }

        }
        /* TODO
        COMBINE WITH SCOUT METHOD, place Construction sites in room while scout is traveling this room to avoid "No Room" Error
        */
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
                var temp_id;
                for(var s_id in sources){
                    //console.log(s_id);
                    var source=Game.getObjectById(s_id);
                    //console.log(source);
                    var storage=Game.getObjectById(Memory.operations[id].nearest_storageId);

                    //console.log('Start');
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
                            //console.log('create Road');
                            //console.log(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                            if(Game.rooms[storage.pos.roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != OK){

                                temp_id=Game.rooms[storage.pos.roomName].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                                if(temp_id.length > 0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                    Memory.operations[id].constructionSites[temp_id[0].id]={};
                                }

                            }else{
                                console.log('Set done to False');
                                done=false;
                            }
                        }
                    }

                    for(var j in roomList){
                        if(Game.rooms[roomList[j].room] != undefined){
                            if(roomList[j].room == source.pos.roomName){
                                var path=source.pos.findPathTo(new RoomPosition(lastPos.x,lastPos.y,source.pos.roomName),{ignoreCreeps: true});
                                for(var i in path){
                                    if(i==0){
                                    //console.log('create Container');
                                    //console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER));
                                    Memory.operations[id].sources[s_id].containerPos = {};
                                    Memory.operations[id].sources[s_id].containerPos.x = path[0].x;
                                    Memory.operations[id].sources[s_id].containerPos.y = path[0].y;

                                    if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER) != OK){

                                        temp_id=Game.rooms[Memory.operations[id].roomName].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                                        if(temp_id.length > 0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                            Memory.operations[id].constructionSites[temp_id[0].id]={};
                                        }
                                    }else{
                                            done=false;
                                    }
                                    }else{
                                        //console.log('create Road');
                                        //console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                                        if(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != OK){

                                            temp_id=Game.rooms[Memory.operations[id].roomName].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                                            if(temp_id.length > 0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                                Memory.operations[id].constructionSites[temp_id[0].id]={};
                                            }
                                        }else{
                                            done=false;
                                        }
                                    }
                                }
                            }else{
                                path=new RoomPosition(lastPos.x,lastPos.y,roomList[j].room).findPathTo(source,{ignoreCreeps: true})
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
                                        //console.log('create Road');
                                        //console.log(Game.rooms[roomList[j].room].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                                        if(Game.rooms[roomList[j].room].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != OK){

                                            temp_id=Game.rooms[roomList[j].room].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                                            if(temp_id.length > 0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                                Memory.operations[id].constructionSites[temp_id[0].id]={};
                                            }
                                        }else{
                                            done=false;
                                        }
                                    }
                                }
                            }
                        }
                    }

                }
            }
            if(done){
                Memory.operations[id].status='BuildingContainer';
            }
        }



        static creepHaul(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            if (creep.memory.targetId == null){ // SELECT NEW TARGET
                if (creep.carry.energy == 0){ // NO ENERGY
                    if (Memory.operations[creep.memory.operation_id].containerId != undefined){ // FOUND CONTAINER
                        creep.memory.targetId = Memory.operations[creep.memory.operation_id].containerId;
                    }else{ // HARVEST // WAIT AT FLAG
                        //creep.memory.targetId = creep.memory.source_id;
                        creep.memory.targetId = creep.id;
                    }
                }else{ // ENOUGH ENERGY
                    creep.memory.targetId = Memory.operations[creep.memory.operation_id].nearest_storageId;
                }
            }else{
                var target = Game.getObjectById(creep.memory.targetId);
                if (target != undefined){ // TARGET IS VALID
                    if (target.structureType == undefined){ // TARGET SOURCE -> HARVEST // TARGET FLAG -> WAIT
                        if (creep.carry.energy == creep.ticksToLive-100){
                            creep.memory.targetId == null;
                        }else if (creep.carry.energy < creep.carryCapacity){
                            //if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                            //    creep.moveTo(target,{reusePath: 30});
                            var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName]
                            if (creep.pos.x != flag.pos.x || creep.pos.y != flag.pos.y){
                                creep.moveTo(flag);
                            }else if(Game.time % 2 == 0){
                                creep.memory.targetId == null;
                            }
                            creep.say("Waiting")
                        }else{ //ENERGY FULL
                            creep.memory.targetId == null;
                            return this.creepHaul(creep);
                        }
                    }else if(target.progress != undefined){ //TARGET CONSTRUCTION SITE -> BUILD
                        var err = creep.build(target);
                        if(err == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target);
                        }else if (err == ERR_FULL){
                            creep.memory.targetId = null;
                            return this.creepHaul(creep);
                        }
                    }else if (target.structureType == STRUCTURE_ROAD){ // TARGET ROAD -> REPAIR
                        creep.repair(target,RESOURCE_ENERGY)
                        creep.memory.targetId = null;
                        return this.creepHaul(creep);
                    }else if (target.structureType == STRUCTURE_CONTAINER){ // TARGET CONTAINER
                        if (creep.room == Memory.operations[creep.memory.operation_id].roomName){
                            var salvage = Rooms[Memory.operations[creep.memory.operation_id].roomName].lookForAt(RESOURCE_ENERGY,pos.x,pos.y); // SALVAGE AVAILABLE?
                            console.log(salvage)
                            if (salvage.length > 0){
                                var err = creep.pickup(salvage[0],RESOURCE_ENERGY)
                                if(err == ERR_NOT_IN_RANGE) {
                                    creep.moveTo(salvage[0],{reusePath: 30,ignoreCreeps: true});
                                    creep.memory.targetId = salvage[0].id;
                                }else if (err == ERR_FULL){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }
                            }
                        }
                        var err = creep.withdraw(target,RESOURCE_ENERGY);
                        if(err == ERR_NOT_IN_RANGE) {
                            creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
                        }else if (err == ERR_FULL){
                            creep.memory.targetId = null;
                            return this.creepHaul(creep);
                        }
                    }else if (target.structureType == STRUCTURE_STORAGE){ // TARGET STORAGE
                        var roadConstructions = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).filter((struct) => struct.structureType == STRUCTURE_ROAD);
                        var road = creep.pos.lookFor(LOOK_STRUCTURES).filter((struct) => struct.structureType == STRUCTURE_ROAD && struct.hits < struct.hitsMax-1000);
                        if (roadConstructions.length){
                            creep.memory.targetId = roadConstructions[0].id;
                            return this.creepHaul(creep);
                        }else if(road.length){
                            creep.repair(road[0],RESOURCE_ENERGY)
                        }else{
                            var err = creep.transfer(target, RESOURCE_ENERGY);
                            if (err == ERR_NOT_IN_RANGE){
                                creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
                            }else if (err == ERR_NOT_ENOUGH_ENERGY){
                                creep.memory.targetId = null;
                                return this.creepHaul(creep);
                            }
                        }
                    }
                }else{ // TARGET IS INVALID
                    creep.memory.targetId = null;
                }
            }
        }

        static creepMine(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            if(Game.time % 10 == 0){
                creep.say('mining');
            }
            if(creep.carry.energy < creep.carryCapacity){
                var source = Game.getObjectById(creep.memory.source_id);
                var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName]
                if(creep.room.name != pos.roomName){
                    creep.moveTo(flag,{reusePath: 30,ignoreCreeps: true});
                }else if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(source);
                }
            }
            if(creep.carry.energy > 0 && creep.room.name == pos.roomName){
                var container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                if(!container.length && creep.carry.energy>35){ // NO CONTAINER & ENOUGH ENERGY FOR 1 BUILD ATTEMPTS
                    if(Memory.operations[creep.memory.operation_id].containerId){ // DELETE GLOBAL OPERATION VAR
                      delete Memory.operations[creep.memory.operation_id].containerId;
                    }
                    var containerConstruction = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                    if (containerConstruction[0] != null){
                        if (creep.build(containerConstruction[0]) == ERR_NOT_IN_RANGE){
                            creep.build(containerConstruction[0]);
                        }
                    }else{
                        container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                        Memory.operations[creep.memory.operation_id].containerId = containers[0].id;
                    }
                }else if(container.length){ // DROP ENERGY
                    if(!Memory.operations[creep.memory.operation_id].containerId){ // SET GLOBAL OPERATION VAR
                      Memory.operations[creep.memory.operation_id].containerId = container[0].id;
                    }
                    if(creep.pos.x != pos.x || creep.pos.y != pos.y){
                        creep.moveTo(pos.x,pos.y);
                    }else{
                        if(container.hits < container.hitsMax-1000) // CONTAINER REPAIR?
                            creep.repair(container);
                        creep.drop(RESOURCE_ENERGY);
                    }
                }
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
