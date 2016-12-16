var scoutingOperation = require('class.operation.scouting');

module.exports = {

    // HANDLE ALL OPERATIONS
    run: function() {
        //Travel to Location
        for(var id in Memory.operations){
            //console.log(Memory.operations[id].type);
            switch (Memory.operations[id].type) {
                case 'scouting':
                    //console.log('Case: Scouting');
                    scoutingOperation.run(id);
                    break;


            }





        }

    }




};
