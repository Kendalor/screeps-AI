Object.defineProperty(Source.prototype, 'memory', {
    get: function() {
        if(_.isUndefined(Memory.sources)) {
            Memory.sources = {};
        }
        if(!_.isObject(Memory.sources)) {
            return undefined;
        }
        return Memory.sources[this.id] = Memory.sources[this.id] || {};
    },
    set: function(value) {
        if(_.isUndefined(Memory.sources)) {
            Memory.sources = {};
        }
        if(!_.isObject(Memory.sources)) {
            throw new Error('Could not set source memory');
        }
        Memory.sources[this.id] = value;
    }
});

//https://github.com/Kendalor/screeps


/*  else{
        if (creep.room.find(STRUCTURE_CONTAINER, {filter: (container) => container.pos == creep.pos}).length != 0)
          creep.drop('energy',creep.carry.energy);
        else
          Game.rooms[creep.room.name].createConstructionSite(creep.pos.x,creep.pos.y,STRUCTURE_CONTAINER);
      }*/