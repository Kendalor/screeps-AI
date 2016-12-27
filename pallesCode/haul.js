  /*CONSTANTS TO REPLACE:
    CONTAINER_POS
    STORAGE_ID
    ROOM_NAME
    SOURCE_ID
    */
  
static creepHaul(creep){
  var ENERGY_SOFT_CAP = creep.carryCapacity-200;
  var pos = CONTAINER_POS;
  if (creep.memory.targetId == null){ // SELECT NEW TARGET
    var containers = Rooms[ROOM_NAME].lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
    if (creep.carry.energy == 0){ // NO ENERGY
      if (containers != null){ // FOUND CONTAINER
        creep.memory.targetId = containers[0].id;
      } 
      else{ // HARVEST
        creep.memory.targetId = SOURCE_ID;
      }
    }
    else if(creep.carry.energy == creep.carryCapacity){ // FULL ENERGY
      if (containers != null){ // GOTO STORAGE{
        creep.memory.targetId = STORAGE_ID;
      }
      else{ // BUILD CONTAINER
        var containerConstructions = Rooms[ROOM_NAME].lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
        if (containerConstructions != null){
          creep.memory.targetId = containerConstructions[0].id;
        }
        else creep.say("Cannot find Container!")
      }
    }
    else if(creep.carry.energy > ENERGY_SOFT_CAP){ // ENOUGH ENERGY
      creep.memory.targetId = STORAGE_ID;
    }
    else if(creep.carry.energy < ENERGY_SOFT_CAP){ // STILL ENOUGH ENERGY ?
      var targets = [containers[0],Game.getObjectById(STORAGE_ID)];
      if (targets[0] != null && targets[1] != null)
        creep.memory.targetId = creep.pos.findClosestByPath(targets,{reusePath: 30,ignoreCreeps: true}).id;
    }
  }
  else{
    var target = Game.getObjectById(creep.memory.targetId);
    if (target != undefined){ // TARGET IS VALID
      if (target.structureType == undefined){ // TARGET SOURCE -> HARVEST
        if (creep.carry.energy < creep.carryCapacity){ 
          if(creep.harvest(target) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target,{reusePath: 30});
          }
        }
        else { //ENERGY FULL
          creep.memory.targetId == null;
          return this.creepHaul(creep);
        }
      }    
      else if(target.progress != undefined){ //TARGET CONSTRUCTION SITE -> BUILD
        var err = creep.build(target);
        if(err == ERR_NOT_IN_RANGE) {
          creep.moveTo(target);
        } 
        else if (err == ERR_FULL){
          creep.memory.targetId = null;
          return this.creepHaul(creep);
        }
      }
      else if (target.structureType == STRUCTURE_ROAD){ // TARGET ROAD -> REPAIR
        creep.repair(target,RESOURCE_ENERGY)
        creep.memory.targetId = null;
        return this.creepHaul(creep);
      }
      }
      else if (target.structureType == STRUCTURE_CONTAINER){ // TARGET CONTAINER
        if (creep.room == ROOM_NAME){
          var salvage = Rooms[ROOM_NAME].lookForAt(RESOURCE_ENERGY,pos.x,pos.y); // SALVAGE AVAILABLE?
          if (salvage != undefined){
            if(creep.pickup(salvage,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
              creep.moveTo(salvage,{reusePath: 30,ignoreCreeps: true});
              creep.memory.targetId = salvage.id;
            }
          }
        }
        if(creep.withdraw(target,RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
          creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
        } 
      } 
      else if (target.structureType == STRUCTURE_STORAGE){ // TARGET STORAGE
        var roadConstructions = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES).filter((struct) => struct.structureType == STRUCTURE_ROAD);
        var road = creep.pos.lookFor(LOOK_STRUCTURES).filter((struct) => struct.structureType == STRUCTURE_ROAD && struct.hits < struct.hitsMax-1000);
        if (roadConstructions != null){
          creep.memory.targetId = roadConstructions.id;
          return this.creepHaul(creep);
        } else if(road != null){
          creep.repair(road,RESOURCE_ENERGY)
        } 
        else{
          var err = creep.transfer(target, RESOURCE_ENERGY);
          if (err == ERR_NOT_IN_RANGE){
            creep.moveTo(target,{reusePath: 30,ignoreCreeps: true});
          }
          else if err == ERR_NOT_ENOUGH_ENERGY{
            reep.memory.targetId = null;
            return this.creepHaul(creep);
          }
        }
      }
    }
    else{ // TARGET IS INVALID
      creep.memory.targetId = null;
    }
  }
}