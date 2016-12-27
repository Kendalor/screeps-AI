/* CONSTANTS TO REPLACE
SOURCE_ID
CONTAINER_POS

*/

static creepMine(creep){
  var pos = CONTAINER_POS
  if(Game.time % 10 == 0){
    creep.say('mining');
  }
  if(creep.carry.energy < creep.carryCapacity){
    var source = Game.getObjectById(SOURCE_ID);
    if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
      creep.moveTo(source);
    }
  }
  if(creep.carry.energy >= 0){
    var container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
    if(container == null && creep.carry.energy>30){ // NO CONTAINER & ENOUGH ENERGY FOR 2 BUILD ATTEMPTS
      var containerConstruction = creep.room.lookForAt('constructionSite',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
      if (containerConstruction[0] != null){
        if (creep.build(containerConstruction[0]) == ERR_NOT_IN_RANGE){
          creep.build(containerConstruction[0]);
        }
      }
      else{
        container = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType == STRUCTURE_CONTAINER);
        Memory.operations[creep.memory.operation_id].containerId = containers[0].id;
      }
    } 
    else if(container != null){ // DROP ENERGY
      if(creep.pos.x != pos.x || creep.pos.y != pos.y){
        creep.moveTo(pos.x,pos.y);
      } 
      else{
        if(container.hits < container.hitsMax-1000) // CONTAINER REPAIR?
          creep.repair(container);
        creep.drop(RESOURCE_ENERGY);
      }
    }
  }
}