var scoutingOperation = require('class.operation.scouting');


module.exports = {

    /** @param {Flag_list} flag_list **/
    run: function() {
        //Travel to Location
        for(var flag in Game.flags){
            }if (this.colorMatch(flag,COLOR_WHITE,COLOR_WHITE)){ //WHITE/WHITE
                scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }
        }
    },
	
	colorMatch: function(flag,color1,color2) {
		return (Game.flags[flag].color == color1 && Game.flags[flag].secondaryColor == color2)
	}


};
