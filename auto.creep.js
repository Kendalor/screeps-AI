const constants  = require('var.const');
var creepRole = constants.creepRole();

var WHITELIST = {'Cade' : true,'InfiniteJoe' : true,'Kendalor' : true,'Palle' : true};

module.exports = {
	/** @param {creepList} creepList **/
		run: function(creepList) {
		for (var id in creepList){
			var creep = creepList[id];
			var job = creep.memory.job;

			switch(creep.memory.role) {
				
				case creepRole[0].name:

					if (creep.memory.spawn){
						creep.room.memory.sources[creep.memory.source].minerId = creep.id;
						delete creep.memory.spawn;
					}

					if (creep.room.energyCapacityAvailable < 500)
						this.allrounder(creep);
					else
						this.miner(creep);


					break;
					
				case creepRole[1].name:
					if (creep.memory.spawn){
						creep.room.memory.sources[creep.memory.source].haulerId = creep.id;
						delete creep.memory.spawn;
					}
					if(!creep.memory.containerId){
						let containerPos = creep.room.memory.sources[creep.memory.source].containerPos;
						//let container = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y});
						let container = creep.room.containers.filter((struct) => struct.pos.x == containerPos.x && struct.pos.y == containerPos.y);
						if (container.length){
							creep.memory.containerId = container[0].id;
							this.hauler(creep);
						}
						else{
							creep.say("No Container");
						}
					}else{
						this.hauler(creep);
					}
					break;
					
				case creepRole[2].name:
					//var container = creep.room.find(FIND_STRUCTURES, {filter: (s) => (s.structureType == STRUCTURE_CONTAINER || s.structureType == STRUCTURE_STORAGE) && s.store[RESOURCE_ENERGY] > creep.carryCapacity});
					var container = [];
					if (creep.room.storage){ 
						container = [creep.room.storage].filter((s) => s.store[RESOURCE_ENERGY] > creep.carryCapacity);
					}
					if (container.length == 0 && creep.room.memory.structures.container){
						container = creep.room.containers.filter((s) => s.store[RESOURCE_ENERGY] > creep.carryCapacity);
					}
					if (container.length == 0 || (creep.room.memory.activeCreepRoles.miner == 0 && creep.room.memory.activeCreepRoles.hauler == 0)){
						this.allrounder(creep);
					}
					else {
						this.maintance(creep);
					}
					break;

				case creepRole[3].name:
					this.upgrader(creep);
					break;

				case creepRole[4].name:
					this.defender(creep);
					break;
					
				case creepRole[5].name:
					this.supplier(creep);
					break;
			
			}			
		}
	},

	allrounder: function(creep) {
		if (creep.room.controller.level > 2){
		this.repairCancel(creep);
		this.upgradeCancel(creep);

		}
		this.mineCancel(creep);
		this.gatherCancel(creep);

		if(creep.room.controller.level <= 2 && creep.room.controller.ticksToDowngrade < 1000)
			this.upgrade(creep);

		this.haul(creep);  
		this.build(creep);
		if (creep.room.controller.level <= 2){
			this.repair(creep);
			this.upgrade(creep);
		}
		this.salvage(creep);
		this.harvest(creep);
	},

	miner: function(creep) {
		this.salvageCancel(creep);
		this.repairCancel(creep);
		this.harvestCancel(creep);
		this.gatherCancel(creep);
		this.haulCancel(creep);
		this.buildCancel(creep);
		this.upgradeCancel(creep);

		this.mine(creep);
	},

	hauler: function(creep){
		this.haul(creep);
		this.salvage(creep);
		this.gather(creep);
		if (!creep.memory.job){
			if (0 == creep.carry.energy && creep.memory.containerId){
				this.travel(creep,creep.memory.containerId);
			}else if(!creep.room.storage && creep.carryCapacity == creep.carry.energy){
				if (!creep.memory.spawnId){
					let spawn = creep.pos.findClosestByPath(creep.room.spawns);
					if (spawn){
						creep.memory.spawnId = spawn.id;
						this.travel(creep,creep.memory.spawnId);
					}
				}else{
					this.travel(creep,creep.memory.spawnId);
				}
			}
		}
	},

	maintance: function(creep){
	    if (!creep.memory.job) {
			if(creep.room.controller.ticksToDowngrade < 5000)
				this.upgrade(creep);
			//if(creep.room.memory.underAttack)
			//    this.repair(creep);
			
			this.repair(creep);
			this.build(creep);
			
			this.haul(creep);
			this.upgrade(creep);
			this.salvage(creep);
			this.gather(creep);
		}else{
			switch(creep.memory.job) {
				case 'build':
					this.build(creep);
					break;
				case 'gather':
					this.gather(creep);
					break;
				case 'haul':
					this.haul(creep);
					break;
				case 'repair':
					this.repair(creep);
					break;
				case 'salvage':
					this.salvage(creep);
					break;
				case 'upgrade':
					this.upgrade(creep);
					break;
				default:
					this.harvestCancel(creep);
			}
		}
	},

	upgrader: function(creep){
		this.gather(creep);
		this.upgrade(creep);
	},

	defender: function(creep){
		this.defend(creep);
	},
	
	supplier: function(creep){
		this.haul(creep);
		this.gather(creep);
		if (!creep.memory.job && creep.carry.energy == creep.carryCapacity){
			if (!creep.memory.spawnId){
				let spawn = creep.pos.findClosestByPath(creep.room.spawns);
				if (spawn){
					creep.memory.spawnId = spawn.id;
					this.travel(creep,creep.memory.spawnId);
				}
			}else{
				this.travel(creep,creep.memory.spawnId);
			}
		}
	},

	harvest: function(creep) {
		if(!creep.memory.job && creep.carry.energy < creep.carryCapacity){
			var sources = creep.room.sources;
			//sources = creep.room.find(FIND_SOURCES); 
			sources = sources.filter((source) => (creep.room.memory.sources[source.id].slots > creep.room.memory.sources[source.id].slotsUsed && source.energy > 0));
			
			if (sources.length > 0){
				var source = creep.pos.findClosestByPath(sources);
				if (source != null){
					this.anounceJob(creep,'harvest');
					creep.memory.tmpSource = source.id;
					creep.room.memory.sources[source.id].slotsUsed++;
				}else{
					creep.say("No path!")
					this.relax(creep);
				}
			}else{
				creep.say("No source!");
				this.relax(creep);
			}
		}
		if(creep.memory.job == 'harvest' && creep.carry.energy < creep.carryCapacity){
			var source = Game.getObjectById(creep.memory.tmpSource);
			if(creep.inRangeTo(source)) {
				if (source.energy){
				    creep.harvest(source);
			    }
			}else{
				creep.travelTo(source);
			}
		}
		if(creep.memory.job == 'harvest' && creep.carry.energy == creep.carryCapacity){
			if (!(!creep.memory.tmpSource)){
				creep.room.memory.sources[creep.memory.tmpSource].slotsUsed--;
				delete creep.memory.tmpSource;
			}
			this.idle(creep);
		}
	},

	harvestCancel: function(creep) {
		if (creep.memory.job == 'harvest'){
			if(creep.memory.tmpSource != undefined){
				creep.room.memory.sources[creep.memory.tmpSource].slotsUsed--;
				delete creep.memory.tmpSource;
			}
			this.idle(creep);
		}
	},

	mine: function(creep) {
		//var tmpContainer = creep.pos.lookFor('structure').filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
		var pos = creep.room.memory.sources[creep.memory.source].containerPos;
		pos = new RoomPosition(pos.x,pos.y,pos.roomName);
		if (!creep.memory.job){
			this.anounceJob(creep,'mine');
			creep.room.memory.sources[creep.memory.source].slotsUsed++;
		}
		if(creep.memory.job == 'mine' && creep.carry.energy < creep.carryCapacity){
			var source = Game.getObjectById(creep.memory.source);
			if(creep.inRangeTo(pos,0)) {
			    if (source.energy){
				    creep.harvest(source);
			    }
			}else{
				creep.travelTo(pos);
			}
		}

		if(creep.memory.job == 'mine' && creep.carry.energy >= 0){
			if(!creep.memory.containerId && creep.carry.energy > 30){
				var containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);

				if (!containers[0]){
					if (creep.room.memory.sources[creep.memory.source].container){
						delete creep.room.memory.sources[creep.memory.source].container;
					}
					var constructions = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
					if (constructions[0] != null){
						creep.build(constructions[0]);
					} else{
						creep.room.createConstructionSite(pos.x,pos.y,STRUCTURE_CONTAINER);
					}
				}
				else{
					if (!creep.room.memory.sources[creep.memory.source].container){
						creep.room.memory.sources[creep.memory.source].container = true;
					}
					creep.memory.containerId = containers[0].id;
					creep.room.memory.sources[creep.memory.source].containerId = containers[0].id;
				}
			}else if(creep.carry.energy > 35 && creep.memory.containerId != null){
				var container = Game.getObjectById(creep.memory.containerId);
				if(container){
    				if(!creep.inRangeTo(container)){
    					creep.travelTo(container);
    				}
    				else{
    				    if(container.hits < container.hitsMax-1000){
    				        creep.repair(container);
    				    }else{
    					    creep.transfer(container,RESOURCE_ENERGY);
    				    }
    				}
				}else{
				    delete creep.memory.containerId;
				}
			}
		}
	},

	mineCancel: function(creep){
		if (creep.memory.job == 'mine'){
			this.idle(creep);
			creep.room.memory.sources[creep.memory.source].slotsUsed--;
		}
	},

	salvage: function(creep) {
		if (!creep.room.memory.underAttack && creep.memory.job == undefined && creep.carry.energy <= creep.carryCapacity/2){
			var salvage = creep.pos.findClosestByPath(creep.room.resources, {filter: (s) => s.energy > creep.carryCapacity && creep.room.name == s.room.name});
			if (salvage != null){
				this.anounceJob(creep,'salvage');
				creep.memory.targetId = salvage.id;
			}
		}
		if(creep.memory.job == 'salvage' && creep.memory.targetId){
			var salvage = Game.getObjectById(creep.memory.targetId);
			if (salvage != null){
			    if(creep.inRangeTo(salvage)){
				    creep.pickup(salvage,RESOURCE_ENERGY);
				}else{
					creep.travelTo(salvage);
				}
			}
			else{
				delete creep.memory.targetId;
			}
		}
		if(creep.memory.job == 'salvage' && (creep.room.memory.underAttack == true || !creep.memory.targetId || creep.carry.energy > 0)){
		this.idle(creep);
		}
	},

	salvageCancel: function(creep){
		if(creep.memory.job == 'salvage'){
			this.idle(creep);
		}
	},

	gather: function(creep) {
		if (!creep.memory.job && creep.carry.energy < creep.carryCapacity){
			if (creep.ticksToLive > 20){
				this.anounceJob(creep,'gather');
			}else{
				creep.suicide();
			}
		}

		if (!creep.memory.containerId){
			if (creep.memory.role == 'hauler' && !creep.memory.containerId) {
				var pos = creep.room.memory.sources[creep.memory.source].containerPos;
				creep.memory.containerId = containers.filter((struct) => struct.pos.x == pos.x && struct.pos.y == pos.y)[0];
			}else{
				var noHaulContainer;
				if (creep.room.controller.level<8 && creep.room.terminal && creep.room.terminal.store.energy > 51000) noHaulContainer = creep.room.terminal;
				if (!noHaulContainer && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > creep.carryCapacity) noHaulContainer = creep.room.storage;
				if (!noHaulContainer && creep.memory.role != 'upgrader') 
					noHaulContainer = creep.pos.findClosestByPath(creep.room.containers, {filter: (s) => s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name == s.room.name})
				if (noHaulContainer){
					creep.memory.containerId = noHaulContainer.id;
				}
			}
		}    
		var container = Game.getObjectById(creep.memory.containerId);
		if(creep.memory.job == 'gather' && container != null && creep.carry.energy < creep.carryCapacity){
			var salvage = container.room.resources.filter( (s) => container.pos.x ==s.pos.x && container.pos.y == s.pos.y && creep.room.name == s.room.name)[0];
			if (salvage != undefined){
				if (creep.inRangeTo(salvage,1)){
					creep.pickup(salvage,RESOURCE_ENERGY);
				}else{
					creep.travelTo(salvage);
				} 
			}else if (creep.inRangeTo(container,1)){
			    if(container.store.energy >= creep.carryCapacity-creep.carry.energy || container.store.energy >= 1000){
				    creep.withdraw(container,RESOURCE_ENERGY);
			    }
			}else{
				if(creep.role != 'upgrader'){
					creep.travelTo(container);
				}else{
					creep.moveTo(container);
				}
			}
		}
		if(creep.memory.job == 'gather' && (creep.carry.energy == creep.carryCapacity || creep.memory.containerId == null || container == null || container.store[RESOURCE_ENERGY] < creep.carryCapacity/4)){
			if (creep.role != 'hauler'){
				delete creep.memory.containerId;
			}
			this.idle(creep);
		}
	},

	gatherCancel: function(creep){
		if(creep.memory.job == 'gather'){
			this.idle(creep);
		}
	},

	build: function(creep) {
		if((creep.carry.energy > 0)&&(!creep.memory.job)){
			var constructions = [];
			if(constructions.length == 0 && creep.room.controller.level > 1) {constructions = creep.room.constructionSitesByType(STRUCTURE_EXTENSION);}
			if(constructions.length == 0) {constructions = creep.room.constructionSitesByType(STRUCTURE_CONTAINER);}
			if(constructions.length == 0) {constructions = creep.room.constructionSitesByType(STRUCTURE_STORAGE);}
			if(constructions.length == 0 & creep.room.controller.level > 2) {constructions = creep.room.constructionSitesByType(STRUCTURE_TOWER);}
			if(constructions.length == 0) {constructions = creep.room.constructionSitesByType(STRUCTURE_ROAD);}
			if(constructions.length == 0) {constructions = creep.room.constructionSitesByType(STRUCTURE_WALL);}
			if(constructions.length == 0) {constructions = creep.room.constructionSites;}
			if(constructions.length > 0){
				this.anounceJob(creep,'build');
				creep.memory.targetId = creep.pos.findClosestByRange(constructions).id;
			}
		}
		var target = Game.getObjectById(creep.memory.targetId);
		if(creep.carry.energy > 0 && creep.memory.job == 'build' && target != null){
		    if(creep.inRangeTo(target)){
		        creep.park();
    			if(creep.build(target) == ERR_INVALID_TARGET){
    				if (target.structureType == STRUCTURE_RAMPART){ 
    					this.idle(creep);
    					return this.repair(creep);
    				}
    				else if (target.structureType == STRUCTURE_WALL || target.structureType == STRUCTURE_ROAD){
    					this.idle(creep);
    					return this.build(creep);
    				}
    			}
		    }else{
		        creep.travelTo(target);
		    }
		}
		if((target == null || creep.carry.energy == 0) && creep.memory.job == 'build'){
		    creep.unpark(true);
			this.idle(creep);
		}
	},

	buildCancel: function(creep){
		if(creep.memory.job == 'build'){
			this.idle(creep);
		}
	},

	repair: function(creep) {
	    var room = creep.room;
		if(creep.carry.energy > 0 && !creep.memory.job){
			var repairTargets = creep.room.roads.filter((structure) => structure.hits < structure.hitsMax-1500);
			if(!repairTargets.length && creep.room.energyCapacityAvailable>=1300){
			    if(!room.memory.structureHitsMin){
			       room.memory.structureHitsMin = 5000; 
			    }
			    let minHits = room.memory.structureHitsMin;
    			if(!repairTargets.length){
    			    repairTargets = room.ramparts.filter((structure) => structure.hits < minHits);
    			}
    			if(!repairTargets.length){
    			    repairTargets = room.constructedWalls.filter((structure) => structure.hits < minHits);
    			}
    			if(!repairTargets.length && minHits < 15000000){
    			   room.memory.structureHitsMin += 1000; 
    			}
			}
			if(repairTargets.length){
			    let repairTarget = creep.pos.findClosestByPath(repairTargets);
			    if(repairTarget){
    			    let type = repairTarget.structureType;
    			    if(type == STRUCTURE_RAMPART || type == STRUCTURE_WALL){
    			        room.memory.structureHitsMin = repairTarget.hits;
    			    }
    				this.anounceJob(creep,'repair');
    				creep.memory.targetId = repairTarget.id;
			    }
			}
		}
		var target = Game.getObjectById(creep.memory.targetId);
		if(creep.carry.energy > 0 && creep.memory.job == 'repair' && target != null && target.hits < target.hitsMax){
		    if(creep.inRangeTo(target,3)){
		        creep.park();
		        creep.repair(target,RESOURCE_ENERGY);
		    }else{
				//creep.travelTo(target);
				creep.moveTo(target,{range:3,ignoreCreeps:true,reusePath:50}); //ignoreRoads:true
	    	}
		}
		if((target == null || creep.carry.energy == 0 || target.hits == target.hitsMax) && creep.memory.job == 'repair'){
		    creep.unpark(true);
			this.idle(creep);
		}
	},

	repairCancel: function(creep){
		if(creep.memory.job == 'repair'){
			this.idle(creep);
		}
	},

	haul: function(creep) {
		var target = Game.getObjectById(creep.memory.targetId);
		if (creep.memory.job == 'haul' && (creep.carry.energy == 0 || target == null 
			|| (target.structureType != STRUCTURE_STORAGE && target.energy == target.energyCapacity) 
			|| (target.structureType == STRUCTURE_STORAGE && target.store.energy == target.storeCapacity))){
			this.idle(creep);
		}
		if (!creep.memory.job && creep.carry.energy > 0){
			var targets = [];
			if (!targets.length){
				targets = creep.room.towers.filter((structure) => structure.energy < structure.energyCapacity-800);
			}
			if (!targets.length){
				targets = creep.room.spawns.filter((structure) => structure.energy < structure.energyCapacity).concat(creep.room.extensions.filter((structure) => structure.energy < structure.energyCapacity));
			}
			if (!targets.length && creep.room.terminal && creep.room.terminal.store.energy<50000){
			    targets = [creep.room.terminal];
			}
			if (!targets.length && creep.room.labs.length){
			    targets = creep.room.labs.filter((l)=>l.energy < 1000);
			}
			if (!targets.length && creep.room.powerSpawn && creep.room.powerSpawn.energy<creep.room.powerSpawn.energyCapacity){
			    targets = [creep.room.powerSpawn];
			}
			if (!targets.length && creep.room.nuker && creep.room.nuker.energy<creep.room.nuker.energyCapacity){
			    targets = [creep.room.nuker];
			}
			//if (creep.memory.role != 'supplier' && !targets.length && creep.carry.energy > 0 ){//creep.carryCapacity/4){
			if (!targets.length && creep.carry.energy > 0 ){//creep.carryCapacity/4){
				targets = creep.room.towers.filter((structure) => structure.energy < structure.energyCapacity-100);
			}
			if (creep.memory.role == 'hauler' && !targets.length && creep.carry.energy > 0 ){//creep.carryCapacity/4){
				targets = [creep.room.storage].filter( (structure) => structure && structure.store.energy < structure.storeCapacity && creep.room.name == structure.room.name);
			}
			if (targets.length){
				target = creep.pos.findClosestByPath(targets);
				if (target){
					creep.memory.targetId = target.id;
					this.anounceJob(creep,'haul');
				} else{
					this.relax(creep);
				}
			}
		}
		if (creep.memory.job == 'haul' && creep.carry.energy > 0){
			var target = Game.getObjectById(creep.memory.targetId);
			if (target.structureType == STRUCTURE_STORAGE || target.structureType == STRUCTURE_TERMINAL){
				if (target.store.energy < target.storeCapacity && creep.inRangeTo(target,1)){
					creep.transfer(target, RESOURCE_ENERGY);
				}else{
					creep.travelTo(target);
				}
			}else{
				if (target.energy < target.energyCapacity && creep.inRangeTo(target,1)){
					creep.transfer(target, RESOURCE_ENERGY);
					/*
					let extensions = creep.room.extensions;
					extensions = extensions.filter(e => Math.abs(e.pos.x - creep.pos.x) <= 1 && Math.abs(e.pos.y - creep.pos.y) <= 1 && target.energy < target.energyCapacity);
					for(let i in extensions){
						if (creep.carry.energy > 0){
							creep.transfer(extensions[i], RESOURCE_ENERGY);
						}
					}*/
				}else{
					creep.travelTo(target);
				}
			}
		}
	},

	haulCancel: function(creep){
		if(creep.memory.job == 'haul'){
			this.idle(creep);
		}
	},

	upgrade: function(creep) {
		if (creep.carry.energy > 0){
			if (!creep.memory.job){
				this.anounceJob(creep,'upgrade');
				creep.memory.targetId=creep.room.controller.id;
			}
			if (creep.memory.job == 'upgrade'){
				var target=Game.getObjectById(creep.memory.targetId);
				var rangeTo = creep.pos.getRangeTo(target);
				switch(rangeTo){
				    case 3:
				        creep.travelTo(target);
				        //creep.moveTo(target,{range:2,ignoreRoads:true,reusePath:10});
				    case 2:
				        //creep.moveTo(target,{range:3,ignoreRoads:true,reusePath:10});
				    case 1:
				        creep.upgradeController(target);
				        break;
				    default:
				        //creep.moveTo(target,{range:2,ignoreRoads:true,reusePath:10});
				        creep.travelTo(target);
				}
				/*
				if(creep.inRangeTo(target,3)) {
				    creep.park();
				    creep.moveTo(target,{range:2});
					creep.upgradeController(target);
					if (creep.memory.role == 'maintance'){
						if(!creep.inRangeTo(target,1)){
							creep.travelTo(target);
						}
					}else{
					    if(creep.room.storage.pos.inRangeTo(target,3)){
					        if(!creep.inRangeTo(target,2)){
						    	creep.travelTo(target);
					    	}
					    }
					}
				}else {
					creep.moveTo(target);
				}*/
			}
		} 
		if((creep.carry.energy == 0 || (creep.memory.workModules && creep.carry.energy < creep.memory.workModules) ) && creep.memory.job == 'upgrade'){
			if (!(!creep.memory.cFlagId)){
				delete creep.memory.cFlagId;
			}
			creep.unpark(true);
			this.idle(creep);
		}
	},

	upgradeCancel: function(creep){
		if(creep.memory.job == 'upgrade'){
			this.idle(creep);
		}
	},

	recharge: function(creep) {
		if (creep.carry.energy > 0){
			if (!creep.memory.job){
				this.anounceJob(creep,'recharge');
				creep.memory.targetId=creep.room.controller.id;
				var controllerFlag = _.filter(Game.flags, (flag) => flag.name == 'Controller' && flag.room.name==creep.room.name);
				if (controllerFlag[0] != null){
					creep.memory.cFlagId = controllerFlag[0].id;
				}
			}
			if (creep.memory.job == 'recharge'){
				var target=Game.getObjectById(creep.memory.targetId);
				if(creep.generateSafeMode(target) == ERR_NOT_IN_RANGE) {
					if(creep.memory.cFlag){
						creep.travelTo(Game.flags.Controller);
					}
					else{
						creep.travelTo(target);
					}
				}
			}
		} 
		if(creep.carry.energy == 0 && creep.memory.job == 'upgrade'){
		if (!(!creep.memory.cFlagId)){
		delete creep.memory.cFlagId;
		}
		this.idle(creep);
		}
	},

	rechargeCancel: function(creep){
		if(creep.memory.job == 'recharge'){
			this.idle(creep);
		}
	},

	defend: function(creep){
		var closestHostile = creep.pos.findClosestByRange(creep.room.hostileCreeps,{filter: (hostile) =>
			WHITELIST[hostile.owner.username] == undefined 
			&& hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 
			&& hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack' || body.type == 'claim').length > 0
			,ignoreDestructibleStructures: true
		});
		if (!closestHostile) closestHostile = creep.pos.findClosestByRange(creep.room.hostileCreeps,{filter: (hostile) =>
			WHITELIST[hostile.owner.username] == undefined 
			&& hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
			&& hostile.body.filter((body) => body.type == 'claim' || body.type == 'work').length > 0
		})
		if(closestHostile){
			if(creep.attack(closestHostile) == ERR_NOT_IN_RANGE){
				creep.travelTo(closestHostile);
				creep.say('DEFENSE !!!');
			}
		}
	},
	
	travel: function(creep,targetId){
		if (targetId){
			let destination = Game.getObjectById(targetId);
			if(destination){
				if (!creep.pos.inRangeTo(destination,1)){
					creep.travelTo(destination);
					return true;
				}else{
					return false;
				}
			}
		}
	},
	
	anounceJob: function(creep,job){
		if(job){
			creep.memory.job=job;
			creep.say(job);
		}else{
			this.idle(creep);
		}
	},

	relax: function(creep){
		if (creep.pos.x > 2 && creep.pos.x < 48 && creep.pos.y > 2 && creep.pos.y < 48)
			creep.move(Game.time%8)
	},

	idle: function(creep){
		creep.say("idle")
		if (creep.memory.targetId){
			delete creep.memory.targetId;
		}
		if (creep.memory.job){
			delete creep.memory.job;
		}
	}

};