module.exports = {
  /** @param {towerList} towerList **/
  clearDeadCreeps: function() {
    for(var name in Memory.creeps) {
      if(!Game.creeps[name]) {
        if (Memory.creeps[name].tmpSourceId){
			let tmpSourceId = Game.getObjectById([Memory.creeps[name].tmpSourceId])
			if (tmpSourceId && tmpSourceId.room && tmpSourceId.room.memory && tmpSourceId.room.memory.sources)
				tmpSourceId.room.memory.sources[Memory.creeps[name].tmpSourceId].slotsUsed--;
        }else if(Memory.creeps[name].role == 'miner' && Memory.creeps[name].job == 'mine' && Memory.creeps[name].source){
			let source = Game.getObjectById([Memory.creeps[name].source])
			source.room.memory.sources[Memory.creeps[name].source].slotsUsed--;
		}
        delete Memory.creeps[name];
        console.log('Clearing non-existing creep memory:', name);
      }
    }
  },
  
	fixSourceSlots: function(room){
		for (var sourceId in room.memory.sources){
			this.fixSource(room,sourceId);
			console.log("Fixed 'slotsUsed' value of Source "+sourceId);
		}
	},
	
	fixSource: function(room,sourceId){
		var slotsUsed = room.myCreeps.filter((creep) => (creep.memory.tmpSourceId == sourceId) || (creep.memory.job == 'mine' && creep.memory.source == sourceId)).length;
		room.memory.sources[sourceId].slotsUsed = slotsUsed;
		/*
		var miner = room.myCreeps.filter((creep) => creep.memory.source == sourceId && creep.role == 'miner');
		if (miner.length > 0) room.memory.sources[sourceId].minerId = miner[0].id;
		
		var hauler = room.myCreeps.filter((creep) => creep.memory.source == sourceId && creep.role == 'hauler');
		if (hauler.length > 0) room.memory.sources[sourceId].minerId = hauler[0].id;
		*/
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
  
  checkRoomMemoryBackup: function(room){
    var sources = Game.rooms[room.name].memory.sources;
    for (i in sources) {
      if (sources[i].containerPos != undefined){
        var containerPos = sources[i].containerPos;
        if (_.filter(room.containers, (struct) => struct.type == STRUCTURE_CONTAINER && struct.pos.x == containerPos.x && struct.pos.y == containerPos.y).length==0)
          room.createConstructionSite(containerPos.x,containerPos.y,STRUCTURE_CONTAINER);
      }
    }
  },
  
  initSourceMemory: function(room) {
    var spawn = _.filter(Game.spawns, (spawn) => spawn.room.name == room.name)
    if(!room.memory.sources && spawn.length){//If this room has no sources memory yet
	  console.log("Initializing room "+room.name);
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
		this.fixSource(room,source.id)
        
        // Calc ContainerPos
        var path = room.findPath(source.pos,source.room.controller.pos,{ignoreCreeps: true});
        var pathArray = Room.deserializePath(Room.serializePath(path));
        source.memory.containerPos = {}
        source.memory.containerPos.x = pathArray[0].x;
        source.memory.containerPos.y = pathArray[0].y;
        source.memory.containerPos.roomName = source.room.name;
		source.memory.requiredCarryParts = Math.ceil((pathArray.length) * 2/5)+1;
        for (var j=1;j<pathArray.length;j++){
        if (room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp")
          source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
        }
      }
    }
  },
  
	initContainerPos: function(room) {
		let sources = room.sources;
		for (i in sources){
			let source = sources[i];
			var path = room.findPath(source.pos,source.room.controller.pos,{ignoreCreeps: true});
			var pathArray = Room.deserializePath(Room.serializePath(path));
			source.memory.containerPos = {}
			source.memory.containerPos.x = pathArray[0].x;
			source.memory.containerPos.y = pathArray[0].y;
			source.memory.containerPos.roomName = source.room.name;
			source.memory.requiredCarryParts = Math.ceil((pathArray.length) * 2/5)+1;
			for (let j=1;j<pathArray.length;j++){
				if (room.lookForAt(LOOK_TERRAIN,pathArray[j].x,pathArray[j].y) == "swamp")
					source.room.createConstructionSite(pathArray[j].x,pathArray[j].y,STRUCTURE_ROAD);
			}
		}
	},
  
  resetSourceMemory: function(room){
	delete Memory.rooms[room.name].sources;
    this.initSourceMemory(room);
	console.log("Resetted room memory of "+room.name)
  }
};