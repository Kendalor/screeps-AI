export class AutoMemory {

    /* @param {towerList} towerList 
     */

    public static clearDeadCreeps(): void {
      for(const name in Memory.creeps) {
        if(!Game.creeps[name]) {

            // FUCKED UP PALLE SOURCE MANAGEMENT PART 
          if (Memory.creeps[name].tmpSource){
              const tmpSource: Source | null = Game.getObjectById(Memory.creeps[name].tmpSource);
              if (tmpSource !== null && tmpSource.room !== undefined && tmpSource.room.memory !== undefined && tmpSource.room.memory.sources !== undefined) {
                tmpSource.room.memory.sources[Memory.creeps[name].tmpSource].slotsUsed--;
              }
          }else if(Memory.creeps[name].role === 'miner' && Memory.creeps[name].job === 'mine' && Memory.creeps[name].source){
              const source: Source | null = Game.getObjectById(Memory.creeps[name].source);
              if( source !== null ) {
                source.room.memory.sources[Memory.creeps[name].source].slotsUsed--;
              }
          }

          // NORMAL PART
          delete Memory.creeps[name];
          console.log('Clearing non-existing creep memory:', name);
        }
      }
    }
    
    public static fixSourceSlots(room: Room): void{
          for (const sourceId in room.memory.sources){
              this.fixSource(room,sourceId);
              console.log("Fixed 'slotsUsed' value of Source "+ sourceId);
          }
      }
      
    public static fixSource(room: Room, sourceId: string): void{
          const slotsUsed: number = room.myCreeps.filter((creep: Creep) => (creep.memory.tmpSource === sourceId) || (creep.memory.job === 'mine' && creep.memory.source === sourceId)).length;
          room.memory.sources[sourceId].slotsUsed = slotsUsed;
          
          const miner = room.myCreeps.filter((creep: Creep) => creep.memory.source === sourceId && creep.memory.role === 'miner');
          if (miner.length > 0) {
            room.memory.sources[sourceId].minerId = miner[0].id;
          }
          
          const hauler = room.myCreeps.filter((creep: Creep) => creep.memory.source === sourceId && creep.memory.role === 'hauler');
          if (hauler.length > 0) {
            room.memory.sources[sourceId].minerId = hauler[0].id;
          }
      }
    
    public static clearFlags(): void {
      for(const name in Memory.flags) {
        if(!Game.flags[name]) {
          if (Memory.flags[name].operation_id){
            delete Memory.operations[Memory.flags[name].operation_id];
          }
          delete Memory.flags[name];
          console.log('Clearing non-existing flag memory:', name);
        }
      }
    }
    
    public static checkRoomMemoryBackup(room: Room): void{
      const sources = room.memory.sources;
      for (const i in sources) {
        if (sources[i].containerPos !== undefined){
          const containerPos = sources[i].containerPos;
          if (_.filter(room.containers, (struct) => struct.structureType === STRUCTURE_CONTAINER && struct.pos.x === containerPos.x && struct.pos.y === containerPos.y).length === 0) {
            room.createConstructionSite(containerPos.x,containerPos.y,STRUCTURE_CONTAINER);
          }
        }
      }
    }
    
    public static initSourceMemory(room: Room): void {
      const spawn: StructureSpawn[] = _.filter(Game.spawns, (s) => s.room.name === room.name);
      if(room.memory.sources === undefined && spawn.length > 0){       // If this room has no sources memory yet
        console.log("Initializing room "+ room.name);
        room.memory.sources = {}; // Add it
        const sources: Source[] = room.find(FIND_SOURCES);   // Find all sources in the current room
        
        const sourcesSorted: Source[] = sources.sort( (s) => s.pos.findPathTo(spawn[0].pos).length );
        sourcesSorted.reverse();
        for(const i of sourcesSorted){
          i.memory = room.memory.sources[i.id] = {containerPos: {x: 0, y:0, roomName: room.name}}; //  Create a new empty memory object for this source
          //  Now you can do anything you want to do with this source
          //  for example you could add a worker counter:
          
          //  Calc Slots & used Slots
          let count = 0;
          for (let x=-1;x<2;x++){
            for (let y=-1;y<2;y++){
              if ((room.lookForAt('terrain',i.pos.x+x,i.pos.y+y)[0] === 'wall') && !(x===0 && y===0)) {//  Check for walls around source
                count = count+1;
              }
            }
          }
          i.memory.slots = 8-count;
          i.memory.slotsUsed = 0;
          this.fixSource(room,i.id)
          
          // Calc ContainerPos
          const path = room.findPath(i.pos,i.room.controller!.pos,{ignoreCreeps: true});
          const pathArray = Room.deserializePath(Room.serializePath(path));
          i.memory.containerPos = {x: pathArray[0].x, y: pathArray[0].y, roomName: i.room.name};
          i.memory.requiredCarryParts = Math.ceil((pathArray.length) * 2/5)+1;
          for (const path of pathArray){
            if (room.lookForAt(LOOK_TERRAIN,path.x,path.y)[0] === "swamp") {
              i.room.createConstructionSite(path.x,path.y,STRUCTURE_ROAD);
            }      
          }
        }
      }
    }
    
    public static initContainerPos(room: Room): void {
          const sources = room.find(FIND_SOURCES);
          for (const i of sources){
              const path = room.findPath(i.pos,i.room.controller!.pos,{ignoreCreeps: true});
              const pathArray = Room.deserializePath(Room.serializePath(path));
              i.memory.containerPos = {x: pathArray[0].x, y: pathArray[0].y, roomName: i.room.name};
              i.memory.requiredCarryParts = Math.ceil((pathArray.length) * 2/5)+1;
              for (const path of pathArray){
                  if (room.lookForAt(LOOK_TERRAIN,path.x,path.y)[0] === "swamp") {
                    i.room.createConstructionSite(path.x,path.y,STRUCTURE_ROAD);
                  }      
              }
          }
    }
    
    public static resetSourceMemory(room: Room): void{
      delete Memory.rooms[room.name].sources;
      this.initSourceMemory(room);
      console.log("Resetted room memory of "+room.name)
    }
  }