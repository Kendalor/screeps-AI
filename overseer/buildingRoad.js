
var roads = {

    /** @param {roomName} roomName **/
	containerRoads: function(roomName){
	    var sources = Game.rooms[roomName].memory.sources;
        for(var id in sources){
            var source=Game.getObjectById(id);
            var spawn=source.pos.findClosestByPath(FIND_MY_SPAWNS, {ignoreCreeps: true});
            var path=source.pos.findPathTo(spawn,{ignoreCreeps: true});
            for(var i in path){
                if(i==0){
                        Game.rooms[roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_CONTAINER);
                    }else{
                        Game.rooms[roomName].createConstructionSite(path[i].x,path[i].y,STRUCTURE_ROAD);
                    }
            }
        }
	}


};

module.exports = roads;