module.exports = {
  /** @param {towerList} towerList **/
  clearDeadCreeps: function() {
    for(var name in Memory.creeps) {
      if(!Game.creeps[name]) {
        if (Memory.creeps[name].tmpSource){
          Game.getObjectById([Memory.creeps[name].tmpSource]).room.memory.sources[Memory.creeps[name].tmpSource].slotsUsed--
        }
        delete Memory.creeps[name];
        console.log('Clearing non-existing creep memory:', name);
      }
    }
  },
  
	fixSourceSlots: function(room){
		for (var source in room.memory.sources){
			var slotsUsed = room.find(FIND_MY_CREEPS,{filter: (creep) => creep.memory.tmpSource == source}).length;
			room.memory.sources[source].slotsUsed = slotsUsed;
			console.log("Fixed 'slotsUsed' value of Source "+source);
		}
	},
  
  clearFlags: function() {
    for(var name in Memory.flags) {
      if(!Game.flags[name]) {
        if (Memory.flags[name].operation_id){
          delete Memory.operations[Memory.flags[name].operation_id];
        }
        delete Memory.flags[name];
        console.log('Clearing non-existing flag memory:', name);
      }
    }
  },
  
  checkRoomMemory: function(room){
    var sources = Game.rooms[room.name].memory.sources;
    for (i in sources) {
      if (sources[i].containerPos != undefined){
        var containerPos = sources[i].containerPos;
        var container = _.filter(FIND_STRUCTURES, (struct) => struct.type == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y)
        var containerExists = container.length;
        if (containerExists){
          if(!room.memory.container){
            room.memory.container = {};
          }
          console.log("1");
          if(!room.memory.container[container.id]){
            container.memory = room.memory.container[container.id] = {}
            container.memory.type = 'sourceContainer';
            console.log("2");
          }
        }
        else if (room.controller.level > 2){
          room.createConstructionSite(containerPos.x,containerPos.y,STRUCTURE_CONTAINER);
        }
      }
    }
  },
  
  checkRoomMemoryBackup: function(room){
    var sources = Game.rooms[room.name].memory.sources;
    for (i in sources) {
      if (sources[i].containerPos != undefined){
        var containerPos = sources[i].containerPos;
        if (_.filter(FIND_STRUCTURES, (struct) => struct.type == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y).length==0)
          room.createConstructionSite(containerPos.x,containerPos.y,STRUCTURE_CONTAINER);
      }
    }
  },
  
  initRoomMemory: function(room) {
    var spawn = _.filter(Game.spawns, (spawn) => spawn.room.name == room.name)
    if(!room.memory.sources && spawn.length){//If this room has no sources memory yet
      room.memory.sources = {}; //Add it
      var sources = room.find(FIND_SOURCES);//Find all sources in the current room
      //var spawn = _.filter(Game.spawns, (spawn) => spawn.room.name == room.name) //Find Room Spawn
      
      var sourcesSorted = []
      for(var i in sources){
        sourcesSorted[i] = spawn[0].pos.findClosestByRange(FIND_SOURCES, {filter: (source) => {var contains = false; for (var j in sourcesSorted) if (source == sourcesSorted[j]) contains = true; return !contains;}});
      }
      sourcesSorted.reverse();
      for(var i in sourcesSorted){
        var source = sourcesSorted[i];
        source.memory = room.memory.sources[source.id] = {}; //Create a new empty memory object for this source
        //Now you can do anything you want to do with this source
        //for example you could add a worker counter:
        room.memory.activeCreepRoles = {}
        
        //Calc Slots & used Slots
        var count = 0;
        for (var x=-1;x<2;x++){
          for (var y=-1;y<2;y++){
            if ((room.lookForAt('terrain',sourcesSorted[i].pos.x+x,sourcesSorted[i].pos.y+y) == 'wall') && !(x==0 && y==0)) //Check for walls around source
              count = count+1;
          }
        }
        source.memory.slots = 8-count;
        source.memory.slotsUsed = 0;
        
        // Calc ContainerPos
        var path = room.findPath(source.pos,source.room.controller.pos,{ignoreCreeps: true});
        var pathArray = Room.deserializePath(Room.serializePath(path));
        source.memory.containerPos = {}
        source.memory.containerPos.x = pathArray[0].x;
        source.memory.containerPos.y = pathArray[0].y;
        source.memory.containerPos.roomName = source.room.name;
        for (var j=1;j<pathArray.length;j++){
        if (room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp")
          source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
        }
      }
    }
  },
  
  renewRoomMemory: function(room){
    delete Memory.rooms[room.name].sources;
  }
};