var constants  = require('var.const');
var creepRole = constants.creepRole();

var WHITELIST = {'Cade' : true,'Kendalor' : true,'Palle' : true};

module.exports = {
  /** @param {creepList} creepList **/
  run: function(creepList) {
    for (var id in creepList){
      var creep = creepList[id];
      var job = creep.memory.job;
      
      
      var containers = creep.room.find(FIND_MY_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER});
      var containersAmount = containers.length;
      
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
			
			if (creep.room.energyCapacityAvailable < 500 ){
				this.allrounder(creep);
			}else{
				var containerPos = creep.room.memory.sources[creep.memory.source].containerPos
				containers = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y});
				if (!creep.memory.containerId && containers.length > 0){
					creep.memory.containerId = containers[0].id;
				}else if (!creep.memory.containerId || (containers[0] != undefined && containers[0].store.energy == 0)){
					this.allrounder(creep);
				}else if(creep.memory.containerId != null && containers[0] != undefined && containers[0].store.energy> 0){
					this.hauler(creep);
				}
			}
          
          break;
        case creepRole[2].name:
          var container = creep.room.find(FIND_STRUCTURES, {filter: (s) => (s.structureType == STRUCTURE_CONTAINER || s.structureType == STRUCTURE_STORAGE) && s.store[RESOURCE_ENERGY] > creep.carryCapacity});
          if (container == 0){
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
    this.containerizeCancel(creep);
	
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
    this.buildCancel(creep);
    this.upgradeCancel(creep);
    this.harvestCancel(creep);
    this.mineCancel(creep);
    this.containerizeCancel(creep);
    
    this.haul(creep);
    this.salvage(creep);
    this.gather(creep);
    
  },
  
  maintance: function(creep){
    this.harvestCancel(creep);
    this.haulCancel(creep);
    if(creep.room.controller.ticksToDowngrade < 1000)
      this.upgrade(creep);
    this.build(creep);
    this.repair(creep);
	this.haul(creep);
    this.upgrade(creep);
    this.salvage(creep);
    this.gather(creep);
  },
  
  upgrader: function(creep){
    this.gather(creep);
    this.upgrade(creep);
  },
  
  defender: function(creep){
    this.defend(creep);
  },
  
  harvest: function(creep) {
    if(creep.memory.job == 'idle' && creep.carry.energy < creep.carryCapacity){
      var sources = creep.room.find(FIND_SOURCES,{filter: (source) => (creep.room.memory.sources[source.id].slots > creep.room.memory.sources[source.id].slotsUsed && source.energy > 0)});
      if (sources.length > 0){
        var source = creep.pos.findClosestByPath(sources);//creep.pos.findClosestByPath(sources);
        if (source != null){
          this.anounceJob(creep,'harvest');
          creep.memory.tmpSource = source.id;
          creep.room.memory.sources[source.id].slotsUsed++;
        }
      }else{
		this.relax(creep);
	  }
    }
    if(creep.memory.job == 'harvest' && creep.carry.energy < creep.carryCapacity){
      var source = Game.getObjectById(creep.memory.tmpSource);
      if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
          creep.moveTo(source);
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
    var tmpContainer = creep.pos.lookFor('structure').filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
    var pos = creep.room.memory.sources[creep.memory.source].containerPos;
    if (creep.memory.job == 'idle' && creep.carry.energy == 0){
      this.anounceJob(creep,'mine');
    }
    if(creep.memory.job == 'mine' && creep.carry.energy < creep.carryCapacity){
      var source = Game.getObjectById(creep.memory.source);
      if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
        creep.moveTo(pos.x,pos.y);
      }
    }
    
    if(creep.memory.job == 'mine' && creep.carry.energy >= 0){
      if(!creep.memory.containerId && creep.carry.energy > 30){
        var containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
        if (containers[0] == null){
          var constructions = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
          if (constructions[0] != null){
            if (creep.build(constructions[0]) == ERR_NOT_IN_RANGE){
              creep.build(constructions[0]);
            }
          }
        }
        else{
          creep.memory.containerId = containers[0].id;
          creep.room.memory.sources[creep.memory.source].containerId = containers[0].id;
        }
      } else if (creep.memory.containerId != null){
        var pos = creep.room.memory.sources[creep.memory.source].containerPos;
        if(creep.pos.x != pos.x || creep.pos.y != pos.y){
          creep.moveTo(pos.x,pos.y);
        }
        else{
          creep.drop(RESOURCE_ENERGY);
        }
      }
    }
    if(creep.carry.energy == 0 && creep.memory.job == 'containerize'){
      this.idle(creep);
    }
  },
  
  mineCancel: function(creep){
    if (creep.memory.job == 'mine'){
      this.idle(creep);
    }
  },
    
  containerize: function(creep){
    if(!creep.memory.containerId && creep.carry.energy>0){
      var pos = creep.room.memory.sources[creep.memory.source].containerPos;
      var containers = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == pos.x && struct.pos.y == pos.y});
      if (containers[0] == null){
        var constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.pos.x == pos.x && site.pos.y == pos.y});
        if (constructions[0] != null){
          if (creep.build(constructions[0]) == ERR_NOT_IN_RANGE){
            creep.build(constructions[0]);
          }
        }
      }
      else{
        creep.memory.containerId = containers[0].id;
        creep.room.memory.sources[creep.memory.source].containerId = containers[0].id;
      }
    }
    if(creep.memory.job == 'idle'){
      this.anounceJob(creep,'containerize');
    }
    if(creep.carry.energy > 0 && creep.memory.job == 'containerize'){
      var pos = creep.room.memory.sources[creep.memory.source].containerPos;
      if(creep.pos.x != pos.x || creep.pos.y != pos.y){
        creep.moveTo(pos.x,pos.y);
      }
      else{
        creep.drop(RESOURCE_ENERGY);
      }
    }
    if(creep.carry.energy == 0 && creep.memory.job == 'containerize'){
      this.idle(creep);
    }
  },
  
  containerizeCancel: function(creep){
    if (creep.memory.job == 'containerize'){
      this.idle(creep);
    }
  },
  
  salvage: function(creep) {
    if (!creep.room.memory.underAttack && creep.memory.job == 'idle' && creep.carry.energy <= creep.carryCapacity/2){
      var salvage = creep.pos.findClosestByPath(FIND_DROPPED_ENERGY, {filter: (s) => s.energy > creep.carryCapacity && creep.room.name == s.room.name});
      if (salvage != null){
        this.anounceJob(creep,'salvage');
        creep.memory.targetId = salvage.id;
      }
    }
    if(creep.memory.job == 'salvage' && creep.memory.targetId != null){
      var salvage = Game.getObjectById(creep.memory.targetId);
      if (salvage != null){
        if(creep.pickup(salvage,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(salvage);
        }
      }
      else{
        creep.memory.targetId = null;
      }
    }
    if(creep.memory.job == 'salvage' && (creep.room.memory.underAttack == true || creep.memory.targetId == null || creep.carry.energy > 0)){
      this.idle(creep);
    }
  },
  
  salvageCancel: function(creep){
    if(creep.memory.job == 'salvage'){
      this.idle(creep);
    }
  },
  
  gather: function(creep) {
    if (creep.memory.job == 'idle' && creep.carry.energy < creep.carryCapacity/4){
      this.anounceJob(creep,'gather');
    }
    
    if (!creep.memory.containerId){
      if (creep.role == 'hauler') {
        var pos = creep.room.memory.sources[creep.memory.source].containerPos;
        creep.memory.containerId = creep.room.find(FIND_STRUCTURES,{filter: (struct) => struct.struct.structureType == STRUCTURE_CONTAINER && struct.pos.x == pos.x && struct.pos.y == pos.y})[0];
        var salvage = container.room.find(FIND_DROPPED_ENERGY, {filter: (s) => container.pos.x ==s.pos.x && container.pos.y == s.pos.y});
        if (salvage[0] != undefined)
          creep.memory.targetId = salvage[0].id;
      }
      else{
        var noHaulContainer = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_STORAGE && s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name == s.room.name})
        if (noHaulContainer == null && creep.role != 'upgrader') noHaulContainer = creep.pos.findClosestByPath(FIND_STRUCTURES, {filter: (s) => s.structureType == STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name == s.room.name})
        if (noHaulContainer != null){
          creep.memory.containerId = noHaulContainer.id;
        }
      }
    }    
    var container = Game.getObjectById(creep.memory.containerId);
    if(creep.memory.job == 'gather' && container != null && creep.carry.energy < creep.carryCapacity){
      
      var salvage = container.room.find(FIND_DROPPED_ENERGY, {filter: (s) => container.pos.x ==s.pos.x && container.pos.y == s.pos.y && creep.room.name == s.room.name})[0];
      if (salvage != undefined){
        if(creep.pickup(salvage,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(salvage);
        } 
      }
      if(creep.withdraw(container,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
        creep.moveTo(container);
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
    if((creep.carry.energy > 0)&&(creep.memory.job == 'idle')){
	var constructions = [];
      if(constructions.length == 0 && creep.room.controller.level >= 2) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_EXTENSION });}
      if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_CONTAINER});}
	  if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_STORAGE});}
      if(constructions.length == 0 & creep.room.controller.level >= 3) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_TOWER});}
      if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_ROAD});}
      if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES,{filter: (site) => site.structureType == STRUCTURE_WALL});}
      if(constructions.length == 0) {constructions = creep.room.find(FIND_CONSTRUCTION_SITES);}
      if(constructions.length > 0){
        this.anounceJob(creep,'build');
        creep.memory.targetId = creep.pos.findClosestByRange(constructions).id;
      }
    }
    var target = Game.getObjectById(creep.memory.targetId);
    if(creep.carry.energy > 0 && creep.memory.job == 'build' && target != null){
      var err = creep.build(target)
      if(err == ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
      else if(err == ERR_INVALID_TARGET){
        if (target.structureType == STRUCTURE_RAMPART){ 
          this.idle(creep);
          return this.repair(creep);
        }
        else if (target.structureType == STRUCTURE_RAMPART || target.structureType == STRUCTURE_ROAD){
          this.idle(creep);
          return this.build(creep);
        }
      }
    }
    if((target == null || creep.carry.energy == 0) && creep.memory.job == 'build'){
      this.idle(creep);
    }
  },
  
  buildCancel: function(creep){
    if(creep.memory.job == 'build'){
      this.idle(creep);
    }
  },
  
  repair: function(creep) {
     if(creep.carry.energy > 0 && creep.memory.job == 'idle'){
      var target_repair = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                            filter: (structure) => (structure.room.name == creep.room.name && structure.hits < structure.hitsMax-1500 && structure.structureType != STRUCTURE_WALL && structure.structureType != STRUCTURE_RAMPART) ||
                            (structure.room.name == creep.room.name && structure.structureType == STRUCTURE_RAMPART && structure.hits < 5000 && creep.room.controller.level > 2) ||
                            (structure.room.name == creep.room.name && structure.structureType == STRUCTURE_WALL && structure.hits < 5000 && creep.room.controller.level > 2)
                        });
      if(target_repair != null){
        this.anounceJob(creep,'repair');
        creep.memory.targetId = target_repair.id;
      }
    }
    var target = Game.getObjectById(creep.memory.targetId);
    if(creep.carry.energy > 0 && creep.memory.job == 'repair' && target != null && target.hits < target.hitsMax){
      if(creep.repair(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
      }
    }
    if((target == null || creep.carry.energy == 0 || target.hits == target.hitsMax) && creep.memory.job == 'repair'){
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
    if (creep.memory.job == 'haul' && (/*creep.carry.energy <= creep.carryCapacity/2*/creep.carry.energy == 0 || target == null || (target.structureType != STRUCTURE_STORAGE && target.energy == target.energyCapacity) || (target.structureType == STRUCTURE_STORAGE && target.store.energy == target.storeCapacity))){
      this.idle(creep);
    }
    if (creep.memory.job == 'idle' && creep.carry.energy > 0){
      /*
      var targets = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return (
          ((structure.structureType == STRUCTURE_EXTENSION || structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity) ||
          (structure.structureType == STRUCTURE_TOWER && structure.energy < structure.energyCapacity-200) ||
          (structure.structureType == STRUCTURE_STORAGE && structure.store.energy < structure.storeCapacity) 
          ) && creep.room.name == structure.room.name;
        }
      });
      */
      var targets = creep.room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => {
          return (structure.structureType == STRUCTURE_EXTENSION ||
          structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity && creep.room.name == structure.room.name;
        }
      });
      if (targets[0] == null && creep.carry.energy > 0 ){//creep.carryCapacity/4){
        targets = creep.room.find(FIND_MY_STRUCTURES, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity-200 && creep.room.name == structure.room.name;
          }
        })
      }
      if (creep. memory.role == 'hauler' && targets[0] == undefined && creep.carry.energy > 0 ){//creep.carryCapacity/4){
        targets = creep.room.find(FIND_MY_STRUCTURES, {
          filter: (structure) => {
            return (structure.structureType == STRUCTURE_STORAGE) && structure.store.energy < structure.storeCapacity && creep.room.name == structure.room.name;
          }
        })
      }
      
      if (targets[0] != undefined && targets[0] != null){
        target = creep.pos.findClosestByPath(targets);
		if (target != undefined){
			creep.memory.targetId = target.id;
			this.anounceJob(creep,'haul');
		} else{
			this.relax(creep);
		}
      }
    }
    if (creep.memory.job == 'haul' && creep.carry.energy > 0){
      var target = Game.getObjectById(creep.memory.targetId);
      if (target.structureType == STRUCTURE_STORAGE){
        if(target.store.energy < target.storeCapacity && creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        }
      }
      else{
        if(target.energy < target.energyCapacity && creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
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
    if (creep.room.controller.level < 8 && creep.carry.energy > 0){
      if (creep.memory.job == 'idle'){
        this.anounceJob(creep,'upgrade');
        creep.memory.targetId=creep.room.controller.id;
        var controllerFlag = _.filter(Game.flags, (flag) => flag.name == 'Controller' && flag.room.name==creep.room.name);
        if (controllerFlag[0] != null){
          creep.memory.cFlagId = controllerFlag[0].id;
        }
      }
      if (creep.memory.job == 'upgrade'){
        var target=Game.getObjectById(creep.memory.targetId);
        if(creep.upgradeController(target) == ERR_NOT_IN_RANGE) {
          if(creep.memory.cFlag){
            creep.moveTo(Game.flags.Controller);
          }
          else{
            creep.moveTo(target);
          }
        }else if (creep.room.storage == undefined){
			creep.moveTo(target);
		}
      }
    } 
    if((creep.carry.energy == 0 || (creep.memory.workModules != undefined && creep.carry.energy < creep.memory.workModules) ) && creep.memory.job == 'upgrade'){
      if (!(!creep.memory.cFlagId)){
        delete creep.memory.cFlagId;
      }
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
      if (creep.memory.job == 'idle'){
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
            creep.moveTo(Game.flags.Controller);
          }
          else{
            creep.moveTo(target);
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
  
  patrol: function(creep) {
    
  },
  
  fight: function(creep) {
    
  },
  
  defend: function(creep){
    var closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
		WHITELIST[hostile.owner.username] == undefined 
		&& hostile.pos.x > 0 && hostile.pos.y > 0 && hostile.pos.x < 49 && hostile.pos.y < 49 
		&& hostile.body.filter((body) => body.type == 'attack' || body.type == 'ranged_attack' || body.type == 'claim').length > 0
		,ignoreDestructibleStructures: true
	});
	if (!closestHostile) closestHostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS,{filter: (hostile) =>
          WHITELIST[hostile.owner.username] == undefined 
          && hostile.pos.x > 1 && hostile.pos.y > 1 && hostile.pos.x < 48 && hostile.pos.y < 48 
          && hostile.body.filter((body) => body.type == 'claim' || body.type == 'work').length > 0
        })
    if(closestHostile){
      if(creep.attack(closestHostile) == ERR_NOT_IN_RANGE){
          creep.moveTo(closestHostile);
          creep.say('DEFENSE !!!');
      }
    }
  },
  
  dance: function(creep) {
    
  },
  
  anounceJob: function(creep,job){
    creep.memory.job=job;
    creep.say(job);
  },
  
  relax: function(creep){
	  creep.say("No path!")
		if (creep.pos.x > 2 && creep.pos.x < 48 && creep.pos.y > 2 && creep.pos.y < 48)
			creep.move(Game.time%8)
  },
  
  idle: function(creep){
    creep.memory.targetId=null;
    creep.memory.job='idle';
  }

};