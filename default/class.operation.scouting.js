

module.exports = class{
        constructor(roomName,flag,id = undefined){
            if(!Game.flags[flag].memory.operation_id){
                this.id=parseInt(Math.random()*10000000);
                this.roomName=roomName;
                console.log(flag);
                this.flagName=flag;

                Game.flags[flag].memory.operation_id=this.id;
                if(!Memory.operations){
                        Memory.operations={};
                    }
                if(!Memory.operations[this.id]){
                    Memory.operations[this.id]={}
                }
                Memory.operations[this.id].roomName=roomName;
                Memory.operations[this.id].flagName=flag;
                console.log(JSON.stringify(this));
            }else{
                this.id = Game.flags[flag].memory.operation_id;
                this.roomName=Memory.operations[this.id].roomName;
                this.flagName=Memory.operations[this.id].flagName;
                console.log(JSON.stringify(this));
            }
        }
        run (){
            console.log(JSON.stingify(this));
        }





};
