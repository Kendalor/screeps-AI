var baseOperation = require('class.operation.base');


module.exports = {

    // HANDLE ALL OPERATIONS
    run: function() {
        //Travel to Location

        for(var id in Memory.operations){
            switch (Memory.operations[id].type) {
                case 'base':
                    //console.log('Case: Scouting');
                    baseOperation.run(id);
                    break;
            }
        }
    },
        init: function() {
        //Travel to Location
        for(var flag in Game.flags){
            if (this.colorMatch(flag,COLOR_WHITE,COLOR_WHITE)){ //WHITE/WHITE
                baseOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }
        }
    },

	colorMatch: function(flag,color1,color2) {
		return (Game.flags[flag].color == color1 && Game.flags[flag].secondaryColor == color2)
	}
};
