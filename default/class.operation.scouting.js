

module.exports = class{
        constructor(roomName,flag,id = undefined){
            if(id == undefined && !Memory.flags[flag].operation_id){

                this.roomName=roomName;
                this.flagName=flag;
                this.id=parseInt(Math.random()*10000000);
                Memory.flags[flag].operation_id=this.id;
            else{

                this.roomName=Memory.operations[id].roomName;
                this.flagName=Memory.operations[id].flag;
                this.id=id;
            }
        }




    }
};
