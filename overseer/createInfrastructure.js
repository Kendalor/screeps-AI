var buildingRoad = require('buildingRoad');

var infrastructure = {
    /** @param {Creep} creep **/
    buildBase: function(ctrlLvl,roomLvl,roomName) {
        for(i= 0; i < ctrlLvl; i++ ){
            switch (i) {
                case 0:
                    //BUILDING ROADS TO SOURCES & CONTAINERS
                    buildingRoad.containerRoads(roomName);
                    Game.rooms[roomName].memory.buildinglvl=1;
                    break;
                case 1:
                    console.log('Upgrading Room '+roomName+' to Level 2');
                    //Generating 5 Extractors + Roads setup around the Spawn
                    for(var j in Game.spawns){ // FIND SPAWN IN THIS ROOM
                        if(Game.spawns[j].room.name == roomName){ // ONLY IF ROOM CONTAINS A SPAWN
                            var spawn_pos=Game.spawns[j].pos;
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-1,spawn_pos.y-1,STRUCTURE_EXTENSION);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-2,spawn_pos.y-1,STRUCTURE_ROAD);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-3,spawn_pos.y-1,STRUCTURE_EXTENSION);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-1,spawn_pos.y,STRUCTURE_ROAD);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-2,spawn_pos.y,STRUCTURE_EXTENSION);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-3,spawn_pos.y,STRUCTURE_ROAD);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-1,spawn_pos.y+1,STRUCTURE_EXTENSION);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-2,spawn_pos.y+1,STRUCTURE_ROAD);
                            Game.rooms[roomName].createConstructionSite(spawn_pos.x-3,spawn_pos.y+1,STRUCTURE_EXTENSION);
                        }

                    }
                    Game.rooms[roomName].memory.buildinglvl=2;

                    break;

                default:

                    break;
            }


        }

	}

};

module.exports = infrastructure;