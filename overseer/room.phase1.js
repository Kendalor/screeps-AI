var createInfrastructure = require('createInfrastructure');


var phase1 = {

    /** @param {Creep} creep **/
    run: function(roomName) {

        if(Game.rooms[roomName].controller.level > Game.rooms[roomName].memory.buildinglvl){

            createInfrastructure.buildBase(Game.rooms[roomName].controller.level,Game.rooms[roomName].memory.buildinglvl,roomName);
        }

	}
};

module.exports = phase1;