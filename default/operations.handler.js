var scoutingOperation = require('class.operation.scouting');
var attackOperation = require('class.operation.attack');
module.exports = {

    // HANDLE ALL OPERATIONS
    run: function() {
        //Travel to Location

        for(var id in Memory.operations){
            switch (Memory.operations[id].type) {
                case 'scouting':
                    //console.log('Case: Scouting');
                    scoutingOperation.run(id);
                    break;
                case 'attack':

                    attackOperation.run(id);
                    break;


            }





        }

    }




};
