var scoutingOperation = require('class.operation.scouting');
var attackOperation = require('class.operation.attack');
var tankOperation = require('class.operation.tank');
module.exports = {

    /** @param {Flag_list} flag_list **/
    run: function() {
        //Travel to Location
        for(var flag in Game.flags){
            if(Game.flags[flag].color == COLOR_RED){

                attackOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_WHITE && Game.flags[flag].secondaryColor == COLOR_WHITE){

                scoutingOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);
            }else if(Game.flags[flag].color == COLOR_GREEN){
                tankOperation.init(Game.flags[flag].pos.roomName,Game.flags[flag].name);

            }





        }

    }




};
