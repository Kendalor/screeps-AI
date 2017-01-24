var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};
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
                        case 'BuildingRoad':
                            this.buildAndRunBuilder(id);
                            this.buildAndRunCreeps(id);
                            break;
                        case 'Mining':
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
            var temp=true;
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
                if(!Memory.operations[id].sources[i].containerId){
                    temp=false;
                    //console.log('test temp to false');
                }
            }
            if(temp){
                console.log('Set Operation Status to Building Road');
                Memory.operations[id].status='BuildingRoad';
            }
        }

        static buildAndRunHauler(id){
            for(var i in Memory.operations[id].sources){
                // HAULER CODE
                if(!Memory.operations[id].sources[i].hauler){ //DOES THIS SOURCE HAVE A MINER
					var spawn = Game.getObjectById(Memory.operations[id].nearest_spawnId)
                    // 1x WORK, 18 CARRY = 900 capacity, 10 MOVE = 1tile/tick on roads if full COST= 1500
					var body = [WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];
					// 1x WORK, 15 CARRY = 550 capacity, 8 MOVE = 1tile/tick on roads if full COST= 1250
					if (spawn.room.energyCapacityAvailable < 2000) body = [CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,MOVE,WORK];
                    if(spawn.canCreateCreep(body,undefined,{role: 'hauling', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=spawn.createCreep(body,undefined,{role: 'hauling', operation_id: id, source_id: i});
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
            //Memory.operations[id].status='BuildingContainer';
            if(Object.keys(Memory.operations[id].constructionSites).length >0){
                for(var i in Memory.operations[id].sources){
                    if(!Memory.operations[id].sources[i].builder){ //DOES THIS SOURCE HAVE A MINER
                        // 5x WORK ( to make up for the walking distance ) , 5 CARRY,and 5 MOVE to assure walk speed = 1/tick COST = 1500
                        if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'building', operation_id: id, container_id: Memory.operations[id].sources[i].containerId}) == OK){// NO SPAWN IT IF POSSIBLE !
                            var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([WORK,WORK,WORK,WORK,WORK,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'building', operation_id: id, container_id: Memory.operations[id].sources[i].containerId});
                            Memory.operations[id].sources[i].builder=name;
                        }
                    }else if(!Game.creeps[Memory.operations[id].sources[i].builder]){
                        console.log('Deleted '+Memory.operations[id].sources[i].builder +' from memory')
                        delete Memory.creeps[Memory.operations[id].sources[i].builder];
                        delete Memory.operations[id].sources[i].builder;
                    }else if(!Game.creeps[Memory.operations[id].sources[i].builder].spawning){
                        //console.log('Run Build for '+Memory.operations[id].sources[i].builder);
                        this.creepBuild(Game.creeps[Memory.operations[id].sources[i].builder]);

                    }
                }

            }else{
                for(var i in Memory.operations[id].sources){
                    if(Game.creeps[Memory.operations[id].sources[i].builder]){
                        Game.creeps[Memory.operations[id].sources[i].builder].suicide();
                    }

                }
                Memory.operations[id].status='Mining';

            }

        }
        static buildAndRunCreeps(id){
			var hostiles = 0;
			if (Game.rooms[Memory.operations[id].roomName] != undefined){
				hostiles=Game.rooms[Memory.operations[id].roomName].find(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
              WHITELIST[hostile.owner.username] == undefined}).length;
			}
            // ITERATE OVER SOURCES
            for(var i in Memory.operations[id].sources){
                // MINER CODE
                if(!Memory.operations[id].sources[i].miner){ //DOES THIS SOURCE HAVE A MINER
                    // 7x WORK ( to make up for the walking distance ) , 1 CARRY,and 7 MOVE to assure walk speed = 1/tick COST = 1150
					var spawn = Game.getObjectById(Memory.operations[id].nearest_spawnId)
                    if(spawn.canCreateCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                        var name=spawn.createCreep([WORK,WORK,WORK,WORK,WORK,WORK,WORK,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE],undefined,{role: 'mining', operation_id: id, source_id: i});
                        Memory.operations[id].sources[i].miner=name;
                    }
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner]){
                    console.log('Deleted '+Memory.operations[id].sources[i].miner +' from memory')
                    delete Memory.creeps[Memory.operations[id].sources[i].miner];
                    delete Memory.operations[id].sources[i].miner;
                }else if(hostiles > 0){
                        Game.creeps[Memory.operations[id].sources[i].miner].moveTo(Game.getObjectById(Memory.operations[id].nearest_storageId));
                }else if(!Game.creeps[Memory.operations[id].sources[i].miner].spawning){
                    this.creepMine(Game.creeps[Memory.operations[id].sources[i].miner]);

                }
                // HAULER CODE

                if(!Memory.operations[id].sources[i].ticksToSource){
                    Memory.operations[id].sources[i].min_haulers=1;
                }else{
                    if(Memory.operations[id].sources[i].path){
                        Memory.operations[id].sources[i].carry_parts=Math.round(Memory.operations[id].sources[i].path.length*2/5);
                        Memory.operations[id].sources[i].min_haulers=Math.round(Memory.operations[id].sources[i].path.length*2/5/18);
                        var max_carry_moveSets=parseInt((Game.getObjectById(Memory.operations[id].nearest_spawnId).room.energyCapacityAvailable-150)/(150));
                        Memory.operations[id].max_carry_moveSets=max_carry_moveSets;
                        // CREATE BODY
                        //TODO

                    }





                }

                if(!Memory.operations[id].sources[i].haulers){
                    Memory.operations[id].sources[i].haulers={};
                }

                if(Object.keys(Memory.operations[id].sources[i].haulers).length < Memory.operations[id].sources[i].min_haulers){
                //console.log('Spawning');
                //console.log(Game.spawns['Spawn1'].canCreateCreep(creep_body, undefined, {role: 'attacker', operation: id, target: Memory.operations[id].flagName}) == OK);
					var spawn = Game.getObjectById(Memory.operations[id].nearest_spawnId)
                    // 1x WORK, 18 CARRY = 900 capacity, 10 MOVE = 1tile/tick on roads if full COST= 1500
					var body = [WORK,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,CARRY,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE,MOVE];
					// 1x WORK, 15 CARRY = 550 capacity, 8 MOVE = 1tile/tick on roads if full COST= 1250
					if (spawn.room.energyCapacityAvailable < 2000) body = [CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,CARRY,MOVE,CARRY,MOVE,WORK];
                    if(spawn.canCreateCreep(body,undefined,{role: 'hauling', operation_id: id, source_id: i}) == OK){// NO SPAWN IT IF POSSIBLE !
                            var name=spawn.createCreep(body,undefined,{role: 'hauling', operation_id: id, source_id: i});
                            Memory.operations[id].sources[i].haulers[name]={};
                    }

                }
                for(var cr in Memory.operations[id].sources[i].haulers){
                    if(!Game.creeps[cr]){
                        console.log('Deleted '+cr +' from memory')
                        delete Memory.creeps[cr];
                        delete Memory.operations[id].sources[i].haulers[cr];
                    }else if(hostiles > 0){
                        Game.creeps[cr].moveTo(Game.getObjectById(Memory.operations[id].nearest_storageId));
                    }else if(!Game.creeps[cr].spawning){
                        this.creepHaul(Game.creeps[cr]);

                    }
                }
            }

        }


        // COMPLETE REWRITE
        //TODO MERGE SCOUT AND BUILDROAD/CONTAINER FUNCTION
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
                var sources = Memory.operations[id].sources;
                var storage=Game.getObjectById(Memory.operations[id].nearest_storageId);
                var done=true;
                for(var s_id in sources){
                 var source=Game.getObjectById(s_id);
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
                          });            if(!Memory.operations[id].sources[source.id].path){
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
                 Memory.operations[id].sources[s_id].ticksToSource=Object.keys(path).length;
                     for(var i in path){
                        //console.log(JSON.stringify(path));
                        if(i==0){
                        //console.log('create Container');
                        //console.log(Game.rooms[Memory.operations[id].roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER));
                        Memory.operations[id].sources[s_id].containerPos = {};
                        Memory.operations[id].sources[s_id].containerPos.x = path[0].x;
                        Memory.operations[id].sources[s_id].containerPos.y = path[0].y;
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
                }
                if(done){
                    Memory.operations[id].status='BuildingContainer';
                }
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
                if(creep.carry.energy == 0 && container){
                    creep.memory.targetId=container.id;
                }else{
                    var target=creep.pos.findClosestByPath(targets);
                    //console.log(JSON.stringify(targets));
                    if(target !=null){
                        creep.memory.targetId=target.id;
                    }else if(targets.length >0 && target == null){
                        creep.moveTo(targets[0]);
                    }else{
                        creep.moveTo(target);
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
                        creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                    }else if (err == ERR_FULL){
                        creep.memory.targetId = null;
                        return this.creepBuild(creep);
                    }
                }else{

                    var err = creep.build(target);
                    if(err == ERR_NOT_IN_RANGE) {
                        creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                    }else if (err == ERR_INVALID_TARGET || err == ERR_NOT_ENOUGH_RESOURCES){
                        creep.memory.targetId = null;
                        return this.creepBuild(creep);
                    }

                }
            }
        }

        static creepHaul_simple(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            if (!creep.memory.targetId){ // SELECT NEW TARGET
                if (creep.carry.energy == 0){ // NO ENERGY
                    if (!Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId){ // NO CONTAINER FOUND
                        creep.memory.targetId = creep.id;
                    }else{ // FOUND CONTAINER
                        creep.memory.targetId = Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId;
                    }
                }else{ // ENOUGH ENERGY
                    creep.memory.targetId = Memory.operations[creep.memory.operation_id].nearest_storageId;
                }
            }else{
                var target = Game.getObjectById(creep.memory.targetId);
                if (target != null){ // TARGET IS VALID
                    if (target.structureType == undefined){ // TARGET SOURCE -> HARVEST // TARGET FLAG -> WAIT
                        if (creep.carry.energy == creep.ticksToLive-100){
                            delete Memory.creeps[creep.name].targetId;
                        }else if (creep.carry.energy < creep.carryCapacity){
                            //if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                            //    creep.moveTo(target,{reusePath: 30});
                            var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName]
                            if (creep.pos.x != flag.pos.x || creep.pos.y != flag.pos.y){
                                creep.moveTo(flag);
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
                            creep.moveTo(target);
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
                            var salvage = creep.room.lookForAt(RESOURCE_ENERGY,pos.x,pos.y); // SALVAGE AVAILABLE?
                            if (salvage.length > 0){
                                var err = creep.pickup(salvage[0],RESOURCE_ENERGY)
                                if(err == ERR_NOT_IN_RANGE) {
                                    creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                                    creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
                                }else if (err == ERR_FULL){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }
                            }else{
                                var err = creep.withdraw(target,RESOURCE_ENERGY);
                                if(err == ERR_NOT_IN_RANGE) {
                                    creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
                                    creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
                                }else if (err == ERR_FULL){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }
                            }
                        } else if(creep.room.name == Game.getObjectById(Memory.operations[creep.memory.operation_id].nearest_storageId).room.name){
                            creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                            creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
                        }
                        else{
                            creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
                            creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
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
                                if (creep.room.name == target.room.name){
                                    creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                                    creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
                                }else{
                                    creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
                                    creep.pickup(creep.pos.lookForAt(LOOK_RESOURCES));
                                }
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

        static creepHaul(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            if (!creep.memory.targetId){ // SELECT NEW TARGET
                if (creep.carry.energy == 0){ // NO ENERGY
                    if (!Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId){ // NO CONTAINER FOUND
                        creep.memory.targetId = creep.id;
                    }else{ // FOUND CONTAINER
                        creep.memory.targetId = Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerId;
                    }
                }else{ // ENOUGH ENERGY
                    creep.memory.targetId = Memory.operations[creep.memory.operation_id].nearest_storageId;
                }
            }else{
                var target = Game.getObjectById(creep.memory.targetId);
                if (target != null){ // TARGET IS VALID
                    if (target.structureType == undefined){ // TARGET SOURCE -> HARVEST // TARGET FLAG -> WAIT
                        if (creep.carry.energy == creep.ticksToLive-100){
                            delete Memory.creeps[creep.name].targetId;
                        }else if (creep.carry.energy < creep.carryCapacity){
                            //if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
                            //    creep.moveTo(target,{reusePath: 30});
                            var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName]
                            if (creep.pos.x != flag.pos.x || creep.pos.y != flag.pos.y){
                                creep.moveTo(flag);
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
                            creep.moveTo(target);
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
                            var salvage = creep.room.lookForAt(RESOURCE_ENERGY,pos.x,pos.y); // SALVAGE AVAILABLE?
                            if (salvage.length > 0){
                                var err = creep.pickup(salvage[0],RESOURCE_ENERGY)
                                if(err == ERR_NOT_IN_RANGE) {
                                    creep.moveTo(target,{reusePath: 1,ignoreCreeps: false});
                                }else if (err == ERR_FULL){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }
                            }else{
                                var err = creep.withdraw(target,RESOURCE_ENERGY);
                                if(err == ERR_NOT_IN_RANGE) {
                                    creep.moveTo(target,{reusePath: 1,ignoreCreeps: false});
                                }else if (err == ERR_FULL){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }
                            }
                        }else if(creep.room.name == Game.getObjectById(Memory.operations[creep.memory.operation_id].nearest_storageId).room.name){
                            creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                        }
                        else{
                            creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
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
                                if (creep.room.name == target.room.name){
                                    creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                                }else{
                                    creep.moveTo(target,{reusePath: 5,ignoreCreeps: false});
                                }
                            }else if (err == ERR_NOT_ENOUGH_ENERGY){
                                if(creep.ticksToLive >= 2* Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].ticksToSource){
                                    creep.memory.targetId = null;
                                    return this.creepHaul(creep);
                                }else{
                                    console.log('suicide '+ creep.name)
                                    creep.suicide();
                                }

                            }
                        }
                    }
                }else{ // TARGET IS INVALID
                    creep.memory.targetId = null;
                }
            }
        }



        /* CONSTANTS TO REPLACE
        SOURCE_ID
        CONTAINER_POS

        */
        static creepMine(creep){
            var pos = new RoomPosition(Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.x,Memory.operations[creep.memory.operation_id].sources[creep.memory.source_id].containerPos.y,Memory.operations[creep.memory.operation_id].roomName);
            if(Game.time % 10 == 0){
                creep.say('mining');
            }
            if(creep.carry.energy < creep.carryCapacity){
                var source = Game.getObjectById(creep.memory.source_id);
                var flag = Game.flags[Memory.operations[creep.memory.operation_id].flagName];
				if (creep.room.storage != undefined){
					creep.moveTo(flag,{reusePath: 5,ignoreCreeps: false});
                }else if(creep.room.name != pos.roomName){
                    creep.moveTo(pos,{reusePath: 30,ignoreCreeps: false});
                }else if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(source);
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
                          console.log(container)
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
                        creep.moveTo(pos.x,pos.y);
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

        static scouting(id){
            if(!Memory.operations[id].s_creep){ //DOES THIS OPERATION ALREADY HAVE A CREEP?
                if(Game.getObjectById(Memory.operations[id].nearest_spawnId).canCreateCreep([MOVE],undefined,{role: 'scout', operation_id: id}) == OK){// NO SPAWN IT IF POSSIBLE !
                    var name=Game.getObjectById(Memory.operations[id].nearest_spawnId).createCreep([MOVE],undefined,{role: 'scout', operation_id: id});
                    var creep=Game.creeps[name];
                    Memory.operations[id].s_creep=name;
                }
                }else if(!Game.creeps[Memory.operations[id].s_creep]){
                    delete Memory.creeps[Memory.operations[id].s_creep];
                    delete Memory.operations[id].s_creep;

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
