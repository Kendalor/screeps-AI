module.exports = class{
        constructor(){
        }
        static run(id){
            // DELETE NONEXISTING CREEPS FROM OPERATION
            if(!this.checkForDelete(id)){ // RUN ONLY IF APPLICABLE
                //IF NOT AVAILABLE
                if(!Memory.operations[id].spawnList){
                    Memory.operations[id].spawnList=this.findClosestSpawn(Game.flags[Memory.operations[id].flagName].pos.roomName,1);
                }
                if(Game.rooms[Memory.operations[id].roomName] == undefined){
                    this.scouting(id);
                }else if(Game.rooms[Memory.operations[id].roomName] != undefined){// IF AVAILABLE
                    this.scouting(id);
                    var room=Game.rooms[Memory.operations[id].roomName];
                    if(Memory.operations[id].keeperRoom == undefined){ // CHECK IF KEEPER ROOM
                        Memory.operations[id].keeperRoom=(room.find(FIND_STRUCTURES,{filter: (str) => str.structureType == STRUCTURE_KEEPER_LAIR}).length >0);
                    }
                    if(Memory.operations[id].keeperRoom && !Memory.operations[id].defendOperationId){ // IF KEEPER ROOM AND NO DEFEND OPERATION FOUND
                        var defFlag = room.find(FIND_FLAGS,{filter: (f) => f.color==COLOR_RED && f.secondaryColor == COLOR_BLUE}); // LOOK FOR DEF FLAGS
                        if(defFlag.length >0){
                            Memory.operations[id].defendOperationId=defFlag[0].memory.operation_id; // WRITE OWN ID INTO DEFEND OPERATION
                            Memory.operations[Memory.operations[id].defendOperationId].toDefend=id;
                        }else{
                            console.log('Place a RED/BLUE Flag in the Room to Defend your Mining Op');
                        }
                    }
                    if(Object.keys(Memory.operations[id].sources).length >0 && (Memory.operations[id].defendOperationId || !Memory.operations[id].keeperRoom)){
                        this.addSourceToOperation(room,id);
                        for(var i in Memory.operations[id].sources){
                            var source=Game.getObjectById(i);
                            var storage=Game.getObjectById(Memory.operations[id].sources[source.id].nearest_storageId);
                            switch (Memory.operations[id].sources[i].status) {
                                case 'createConstructionSites':
                                    this.buildRoadAndContainer(id,source,storage);
                                    break;
                                case 'BuildingContainer':
                                    this.buildAndRunMiner(id,source);
                                    break;
                                case 'BuildingRoad':
                                    this.buildAndRunBuilder(id,source);
                                    this.buildAndRunCreeps(id,source);
                                    break;
                                case 'Mining':
                                    this.buildAndRunCreeps(id,source);
                                    break;
                            }
                        }
                    }else{
                        this.addSourceToOperation(room,id);
                        console.log('No Sources for Operation ' + id+ ' place a Blue/Purple Flag on a Source to Add');

                    }
                }
            }
        }
        static addSourceToOperation(room,id){
            var flags=room.find(FIND_FLAGS,{filter: f => f.color == COLOR_BLUE && f.secondaryColor == COLOR_PURPLE});
            /* FOR LATER
            var spawnList=_.map(Game.spawns, function(spawn) {
                return {pos: spawn.pos, range: 1};
            });

            var storageList= _.map(Game.spawns, function(spawn) {
                if(spawn.room.controller != undefined){
                    return {pos: spawn.room.controller.pos, range: 1};
                }
            });*/
            if(flags.length >0){
                for(var i in flags){
                    var sources=flags[i].pos.lookFor(LOOK_SOURCES);
                    //console.log(sources.length);
                    if(sources.length > 0){
                        var source=sources[0];
                        //console.log(source);
                        if(!Memory.operations[id].sources[source.id]){
                           //console.log(JSON.stringify(source));
                            source.memory = Memory.operations[id].sources[source.id] = {};
                            //TODO SEARCH FORE NEAREST SPAWN/STORAGE WITH PATHFINDER
                            Memory.operations[id].sources[source.id].nearest_storageId=this.findClosestStorage(id,source);
                            Memory.operations[id].sources[source.id].status='createConstructionSites';
                            Memory.operations[id].sources[source.id].min_haulers=1;
                            Memory.operations[id].sources[source.id].min_builders=1;
                            Memory.operations[id].sources[source.id].min_miners=1;
                            Memory.operations[id].sources[source.id].miners={};
                            Memory.operations[id].sources[source.id].haulers={};
                            Memory.operations[id].sources[source.id].builders={};
                            if(Memory.operations[id].keeperRoom){
                                var lair=source.pos.findInRange(FIND_STRUCTURES,5,{filter: (str) => str.structureType == STRUCTURE_KEEPER_LAIR });
                                if(lair.length>0){
                                     Memory.operations[id].sources[source.id].keeperLair=lair[0].id;
                                }
                            }
                        }else{
                            Memory.operations[id].sources[source.id].status='createConstructionSites';
                        }
                    }else{
                        console.log('No Source at flag pos found');
                    }
                    flags[i].remove();
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
                Memory.operations[this.id].type='remote_mining_keeper';
                Memory.operations[this.id].spawnList=this.findClosestSpawn(roomName,1);
                Memory.operations[this.id].status='createConstructionSites';
                Memory.operations[this.id].constructionSites={};
                Memory.operations[this.id].sources = {};
                Memory.operations[this.id].scouts={};
                Memory.operations[this.id].min_scouts=1;



                if(!Game.rooms[roomName]){
                    Memory.operations[this.id].scouting=true;
                }else{
                    Memory.operations[this.id].scouting=false;

                }



                console.log(JSON.stringify(Memory.operations[this.id]));
            }
        }

        // BUILD CREEPS FOR HAULING AND MINING
        static buildAndRunMiner(id,source){
            var temp=true;
            // STANDART CODE IF NO ENEMY IS NEAR
            // MINER CODE
            let spawnList=Memory.operations[id].spawnList;
            let body=[WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];

            Memory.operations[id].sources[source.id].miners=this.creepBuilder(spawnList,Memory.operations[id].sources[source.id].miners,Memory.operations[id].sources[source.id].min_miners,body,{role: 'mining', operation_id: id, source_id: source.id});
            Memory.operations[id].sources[source.id].miners=this.cleanUpCreeps(Memory.operations[id].sources[source.id].miners);

            for(var t in Memory.operations[id].sources[source.id].miners){
                var creep=Game.creeps[t];
                if(!creep.spawning){
                    this.creepMine(creep);

                }
            }
            if(!Memory.operations[id].sources[source.id].containerId){
                temp=false;
                //console.log('test temp to false');
            }
            if(temp){
                console.log('Set Operation Status to Building Road');
                Memory.operations[id].sources[source.id].status='BuildingRoad';
            }


        }
        static buildAndRunBuilder(id,source){
            //Memory.operations[id].status='BuildingContainer';
            if(Object.keys(Memory.operations[id].constructionSites).length >0){
                let spawnList=Memory.operations[id].spawnList;
                let body=[WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE];

                Memory.operations[id].sources[source.id].builders=this.creepBuilder(spawnList,Memory.operations[id].sources[source.id].builders,Memory.operations[id].sources[source.id].min_builders,body,{role: 'building', operation_id: id, container_id: Memory.operations[id].sources[source.id].containerId});
                Memory.operations[id].sources[source.id].builders=this.cleanUpCreeps(Memory.operations[id].sources[source.id].builders);

                for(var t in Memory.operations[id].sources[source.id].builders){
                    var creep=Game.creeps[t];
                    if(!creep.spawning){
                        this.creepBuild(creep);
                    }
                }
            }else{
                if(Game.creeps[Memory.operations[id].sources[source.id].builder]){
                    Game.creeps[Memory.operations[id].sources[source.id].builder].suicide();
                }
                Memory.operations[id].sources[source.id].status='Mining';
            }

        }
        static buildAndRunCreeps(id,source){

            // ITERATE OVER SOURCES

            // MINER CODE
            let spawnList=Memory.operations[id].spawnList;
            let body=[WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];

            Memory.operations[id].sources[source.id].miners=this.creepBuilder(spawnList,Memory.operations[id].sources[source.id].miners,Memory.operations[id].sources[source.id].min_miners,body,{role: 'mining', operation_id: id, source_id: source.id});
            Memory.operations[id].sources[source.id].miners=this.cleanUpCreeps(Memory.operations[id].sources[source.id].miners);

            for(var t in Memory.operations[id].sources[source.id].miners){
                var creep=Game.creeps[t];
                if(!creep.spawning){
                    if(!Memory.operations[id].sources[source.id].keeper){
                        this.creepMine(creep);
                    }
                }
            }
            // HAULER CODE
            if(!Memory.operations[id].sources[source.id].hauler_body){
                let length=Memory.operations[id].sources[source.id].path.length;
                let carryParts=Math.min(Math.floor(length*2*4000/300/50)+1,32);
                let moveParts=Math.ceil(carryParts/2+1);
                let workParts=1;
                let body2=Array(carryParts+moveParts+workParts).fill(CARRY,0,carryParts).fill(MOVE,carryParts,carryParts+moveParts).fill(WORK,carryParts+moveParts,carryParts+moveParts+workParts);
                Memory.operations[id].sources[source.id].hauler_body=body2;
            }

            body=Memory.operations[id].sources[source.id].hauler_body;

            Memory.operations[id].sources[source.id].haulers=this.creepBuilder(spawnList,Memory.operations[id].sources[source.id].haulers,Memory.operations[id].sources[source.id].min_haulers,body,{role: 'hauling', operation_id: id, source_id: source.id});
            Memory.operations[id].sources[source.id].haulers=this.cleanUpCreeps(Memory.operations[id].sources[source.id].haulers);

            for(var t in Memory.operations[id].sources[source.id].haulers){
                var creep=Game.creeps[t];
                if(!creep.spawning){
                    this.creepHaul(creep);

                }
            }
        }


        // COMPLETE REWRITE
        //TODO MERGE SCOUT AND BUILDROAD/CONTAINER FUNCTION
        static buildRoadAndContainer(id,source,storage){
            var done=true;

            if(!Memory.operations[id].sources[source.id].path){
                var path=PathFinder.search(source.pos,{pos: storage.pos, range: 1},{plainCost: 4, swampCost: 4,
                      roomCallback: function(roomName) {
                      let room = Game.rooms[roomName];
                      if(!room) return;
                      let costs = new PathFinder.CostMatrix;
                      room.find(FIND_STRUCTURES).forEach(function(structure) {
                        if(structure.structureType == STRUCTURE_ROAD)  {
                            costs.set(structure.pos.x, structure.pos.y, 2);
                        }else if(structure.structureType == STRUCTURE_RAMPART) {
                            costs.set(structure.pos.x, structure.pos.y,2);
                        }else{
                            costs.set(structure.pos.x, structure.pos.y,0xff);
                        }
                      });

                      room.find(FIND_CONSTRUCTION_SITES).forEach(function(constr) {
                        if(constr.structureType == STRUCTURE_ROAD)  {
                            costs.set(constr.pos.x, constr.pos.y, 2);
                        }else if(constr.structureType == STRUCTURE_RAMPART) {
                            costs.set(constr.pos.x, constr.pos.y,2);
                        }else{
                            costs.set(constr.pos.x, constr.pos.y,0xff);
                        }
                      });

                      return costs;

                      }}).path;

                    Memory.operations[id].sources[source.id].path=path;
            }else{
                var path=Memory.operations[id].sources[source.id].path;
            }


                 for(var i in path){
                    //console.log(JSON.stringify(path));
                    if(i==0){
                    //console.log('create Container');
                    //console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER));
                    Memory.operations[id].sources[source.id].containerPos = {};
                    Memory.operations[id].sources[source.id].containerPos.x = path[0].x;
                    Memory.operations[id].sources[source.id].containerPos.y = path[0].y;
                        if(Game.rooms[path[i].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER) != OK){
                            var temp_id=Game.rooms[path[i].roomName].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                            if(temp_id.length >0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                Memory.operations[id].constructionSites[temp_id[0].id]={};
                            }
                        }else{
                                done=false;
                        }
                    }else{
                        //console.log('create Road');
                        //console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD));
                        if(Game.rooms[path[i].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD) != OK){

                            var temp_id=Game.rooms[path[i].roomName].lookForAt(LOOK_CONSTRUCTION_SITES,path[i].x,path[i].y);
                            if(temp_id.length >0 && !Memory.operations[id].constructionSites[temp_id[0].id]){
                                Memory.operations[id].constructionSites[temp_id[0].id]={};
                            }
                        }else{
                            done=false;
                        }
                    }
                }

            if(done){
                Memory.operations[id].sources[source.id].status='BuildingContainer';
            }

        }

          /*CONSTANTS TO REPLACE:
    CONTAINER_POS = new RoomPosition(Memory.operations[creep.memory.operation_id].source[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].source[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
    STORAGE_ID = Memory.operations[creep.memory.operation_id].nearest_storageId
    ROOM_NAME = Memory.operations[creep.memory.operation_id].roomName
    SOURCE_ID = creep.memory.source_id
    */
        static creepBuild(creep){
            var container=Game.getObjectById(creep.memory.container_id);
            var targets = [];
            for(var i in Memory.operations[creep.memory.operation_id].constructionSites){
                if(!Game.constructionSites[i]){
                    delete Memory.operations[creep.memory.operation_id].constructionSites[i];
                }else{
                    targets.push(Game.getObjectById(i));
                }

            }
            if(creep.memory.targetId == null){
                if(creep.carry.energy == 0){
                    console.log('creep'+creep.name);
                    console.log(creep.memory.container_id);
                    creep.memory.targetId=container.id;
                }else{
                    var target=creep.pos.findClosestByRange(targets);
                    if(target !=null){
                        creep.memory.targetId=target.id;
                    }else{
                        creep.travelTo(targets[0]);
                    }

                    //console.log(JSON.stringify(creep.pos.findClosestByRange(targets).id));
                }
            }else{
                var target=Game.getObjectById(creep.memory.targetId);
                //console.log(JSON.stringify(target));
                if(target == null){
                    delete creep.memory.targetId;
                    return this.creepBuild(creep);
                }
                if(target.structureType == STRUCTURE_CONTAINER){

                    var err = creep.withdraw(target,RESOURCE_ENERGY);
                    if(err == ERR_NOT_IN_RANGE) {
                        creep.travelTo(target,{reusePath: 5,ignoreCreeps: false});
                    }else if (err == ERR_FULL){
                        creep.memory.targetId = null;
                        return this.creepBuild(creep);
                    }
                }else{

                    var err = creep.build(target);
                    if(err == ERR_NOT_IN_RANGE) {
                        creep.travelTo(target,{reusePath: 5,ignoreCreeps: false});
                    }else if (err == ERR_INVALID_TARGET || err == ERR_NOT_ENOUGH_RESOURCES){
                        creep.memory.targetId = null;
                        return this.creepBuild(creep);
                    }

                }
            }
        }

        static creepHaul_simple(creep){
            switch(creep.memory.status){
                case 'undefined':
                    break;
                case 'fetch':
                    break;
                case 'return':
                    break;
                default:
                    break;
            }

        }

        static creepHaul(creep){

            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);

            var enemies=pos.findInRange(FIND_HOSTILE_CREEPS,5);
            if(enemies.length >0 || creep.room.memory.invasion || Memory.operations[creep.memory.operation_id].invasion){
                creep.say('Afraid');
                this.creepEvacuate(creep);
            }else{
                if (!creep.memory.targetId){ // SELECT NEW TARGET
                    creep.say('No Target');
                    if (creep.carry.energy == 0){ // NO ENERGY
                        if (!Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId){ // NO CONTAINER FOUND
                            creep.memory.targetId = creep.id;
                        }else{ // FOUND CONTAINER
                            creep.memory.targetId = Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId;
                        }
                    }else{ // ENOUGH ENERGY
                        creep.memory.targetId = Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].nearest_storageId;
                    }
                }else{
                    var target = Game.getObjectById(creep.memory.targetId);
                    if (target != null){ // TARGET IS VALID
                        if (target.structureType == undefined){ // TARGET SOURCE -> HARVEST // TARGET FLAG -> WAIT
                            if (creep.carry.energy == creep.ticksToLive-100){ // HAE ????
                                delete Memory.creeps[creep.name].targetId;
                            }else if (creep.carry.energy < creep.carryCapacity){
                                //if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                                //    creep.travelTo(target,{reusePath: 30});
                                var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName]
                                if (creep.pos.x != flag.pos.x || creep.pos.y != flag.pos.y){
                                    creep.travelTo(flag);
                                }else if(Game.time % 2 == 0){
                                    creep.memory.targetId = null;
                                }
                                creep.say("Waiting")
                            }else{ //ENERGY FULL
                                delete Memory.creeps[creep.name].targetId;
                                return this.creepHaul(creep);
                            }
                        }else if(target.progress != undefined){ //TARGET CONSTRUCTION SITE -> BUILD
                            var err = creep.build(target);
                            if(err == ERR_NOT_IN_RANGE) {
                                creep.travelTo(target);
                            }else if (err == ERR_FULL){
                                delete Memory.creeps[creep.name].targetId;
                                return this.creepHaul(creep);
                            }else if (err == ERR_NOT_ENOUGH_ENERGY){
                                delete Memory.creeps[creep.name].targetId;
                                return this.creepHaul(creep);
                            }
                        }else if (target.structureType == STRUCTURE_ROAD){ // TARGET ROAD -> REPAIR
                            creep.repair(target,RESOURCE_ENERGY)
                            creep.memory.targetId = null;
                            return this.creepHaul(creep);
                        }else if (target.structureType == STRUCTURE_CONTAINER){ // TARGET CONTAINER
                            if (creep.room.name == Memory.operations[creep.memory.operation_id].roomName){
                                var salvage = creep.pos.findInRange(FIND_DROPPED_RESOURCES,1); // SALVAGE AVAILABLE?
                                if (salvage.length > 0){
                                    creep.say('salvage');
                                    for(var t in salvage){
                                        var err = creep.pickup(salvage[t]);
                                        if (err == ERR_FULL){
                                            creep.memory.targetId = null;
                                            return this.creepHaul(creep);
                                        }
                                    }
                                    creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                }else{
                                    var err = creep.withdraw(target,RESOURCE_ENERGY);
                                    if(err == ERR_NOT_IN_RANGE) {
                                        creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                    }else if (err == ERR_FULL){
                                        creep.memory.targetId = null;
                                        return this.creepHaul(creep);
                                    }
                                }
                            }else if(creep.room.name == Game.getObjectById(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].nearest_storageId).room.name){
                                creep.travelTo(target,{reusePath: 5,ignoreCreeps: false});
                            }
                            else{
                                var salvage = creep.pos.findInRange(FIND_DROPPED_RESOURCES,1); // SALVAGE AVAILABLE?
                                if (salvage.length > 0){
                                    creep.say('salvage');
                                    for(var t in salvage){
                                        var err = creep.pickup(salvage[t]);
                                        if (err == ERR_FULL){
                                            creep.memory.targetId = null;
                                            return this.creepHaul(creep);
                                        }
                                    }
                                    creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                }else{
                                    var err = creep.withdraw(target,RESOURCE_ENERGY);
                                    if(err == ERR_NOT_IN_RANGE) {
                                        creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                    }else if (err == ERR_FULL){
                                        creep.memory.targetId = null;
                                        return this.creepHaul(creep);
                                    }
                                }
                            }
                        }else if (target.structureType == STRUCTURE_STORAGE){
                            // TARGET STORAGE
                            var roadConstructions = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).filter((struct) => struct.structureType == STRUCTURE_ROAD);
                            var road = creep.pos.lookFor(LOOK_STRUCTURES).filter((struct) => struct.structureType == STRUCTURE_ROAD && struct.hits < struct.hitsMax);
                            if (roadConstructions.length > 0 && creep.carry.energy > 0){
                                    creep.memory.targetId = roadConstructions[0].id;
                                    return this.creepHaul(creep);
                            }else if(road.length && creep.carry.energy > 0){
                                creep.repair(road[0],RESOURCE_ENERGY)
                                if (creep.room.name == target.room.name){
                                        creep.travelTo(target,{reusePath: 5,ignoreCreeps: false});
                                }else{
                                        creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                }
                            }else{
                                var err = creep.transfer(target, RESOURCE_ENERGY);
                                if (err == ERR_NOT_IN_RANGE){
                                    if (creep.room.name == target.room.name){
                                        creep.travelTo(target,{reusePath: 5,ignoreCreeps: false});
                                    }else{
                                        creep.travelTo(target,{reusePath: 30,ignoreCreeps: false});
                                    }
                                }else if (err == ERR_NOT_ENOUGH_RESOURCES){
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
        }

        /* CONSTANTS TO REPLACE
        SOURCE_ID
        CONTAINER_POS
        */
        static creepEvacuate(creep){
            if(!creep.memory.safeSpot){
                let opId=creep.memory.operation_id;
                let sourceId=creep.memory.source_id;
                let storage=Game.getObjectById(Memory.operations[opId].sources[sourceId].nearest_storageId);
                let pos=new RoomPosition(25,25,storage.pos.roomName);
                console.log(pos);
                creep.memory.safeSpot=pos;
            }else{
                let pos=new RoomPosition(creep.memory.safeSpot.x,creep.memory.safeSpot.y,creep.memory.safeSpot.roomName);
                creep.travelTo(pos);
            }

        }

        static creepMine(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            var enemies=pos.findInRange(FIND_HOSTILE_CREEPS,5);
            if(enemies.length >0 || creep.room.memory.invasion || Memory.operations[creep.memory.operation_id].invasion){
                creep.say('Afraid');
                this.creepEvacuate(creep);
            }else{
                if(Game.time % 10 == 0){
                    creep.say('mining');
                }
                if(creep.carry.energy < creep.carryCapacity){
                    var source = Game.getObjectById(creep.memory.source_id);
                    var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName];
                    if (creep.room.storage != undefined){
                        creep.travelTo(flag,{reusePath: 5,ignoreCreeps: false});
                    }else if(creep.room.name != pos.roomName){
                        creep.travelTo(flag,{reusePath: 5,ignoreCreeps: false});
                    }else if(creep.harvest(source) == ERR_NOT_IN_RANGE){
                        creep.travelTo(pos);
                    }
                }
                if(creep.carry.energy > 0 && creep.room.name == pos.roomName){
                    var container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                    var rampart = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_RAMPART);
                    if(container.length == 0 && creep.carry.energy>35){ // NO CONTAINER & ENOUGH ENERGY FOR 1 BUILD ATTEMPTS
                        if(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId){ // DELETE GLOBAL OPERATION VAR
                          delete Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId;
                        }
                        var containerConstruction = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                        if (containerConstruction[0] != null){
                            if (creep.build(containerConstruction[0]) == ERR_NOT_IN_RANGE){
                                creep.build(containerConstruction[0]);
                            }
                        }else{
                            container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
                            if (container.length > 0){
                              Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId = container[0].id;
                            }else{
                              creep.room.createConstructionSite(pos.x,pos.y,STRUCTURE_CONTAINER);
                            }
                        }
                    }else if(container.length){ // DROP ENERGY
                        if(!Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId){ // SET GLOBAL OPERATION VAR
                          Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId = container[0].id;
                        }
                        if(creep.pos.x != pos.x || creep.pos.y != pos.y){
                            creep.travelTo(pos);
                        }else{
                            if(container[0].hits < container[0].hitsMax-700){
                                creep.repair(container[0]);
                                //creep.say('Repair');
                            }else if(rampart.length){
                                if(rampart[0].hits < 500000){
                                    creep.repair(rampart[0]);
                                }

                            }else{
                                creep.drop(RESOURCE_ENERGY);
                            }
                        }
                    }
                }
            }
        }

        static scouting(id){
            if(!Memory.operations[id].scouts){
                Memory.operations[id].scouts={};
            }

            if(!Memory.operations[id].min_scouts){
                Memory.operations[id].min_scouts=1;
            }

            Memory.operations[id].scouts=this.creepBuilder(Memory.operations[id].spawnList,Memory.operations[id].scouts,Memory.operations[id].min_scouts,[MOVE],{role: 'scout', operation_id: id});
            Memory.operations[id].scouts=this.cleanUpCreeps(Memory.operations[id].scouts);

            for(var j in Memory.operations[id].scouts){
                var creep=Game.creeps[j];
                if(!creep.spawning){
                    if(creep.pos == Game.flags[Memory.operations[id].flagName].pos){

                    }else{
                        creep.travelTo(Game.flags[Memory.operations[id].flagName].pos);
                    }

                }
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
                            if(spawn.canSpawnCreep(body, undefined, memory) == OK){
                                var name=spawn.spawnCreep(body,undefined,memory);
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

        static findClosestStorage(id,source){
            var length=99999999;
            var temp;
            var storage;
            for(var i in Memory.myRooms){
                if(Game.rooms[i]){
                    var room=Game.rooms[i];
                    if(room.storage){
                        temp=PathFinder.search(room.storage.pos,{pos: source.pos,range: 1},{plainCost: 1,swampCost: 1}).path.length;
                        if(temp<length){
                            length=temp;
                            storage=room.storage;
                        }
                    }
                }
            }

            return storage.id;
        }

        static isIdFree(id){
            var out=true;
            for(var i in Memory.operations){
                if(Memory.operations[id]){
                    out= false;
                }
            }
            return out;
        }
};
