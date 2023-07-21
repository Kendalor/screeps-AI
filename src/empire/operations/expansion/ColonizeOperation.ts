import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";
import { FlagOperation, FlagOperationProto } from "../Operations/FlagOperation";
import { RemoteOperationProto, RemoteOperation, RemoteOperationData } from "../Operations/RemoteOperation";
import { RoomOperation, RoomOperationData } from "../Operations/RoomOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ColonizeOperation extends FlagOperation {
    public numCreeps: number = 6;
    public COLONIZE_TIMEOUT = 5000;

    constructor(name: string, manager: OperationsManager, entry: FlagOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.COLONIZE;
        this.priority=28;
    }



    public run() {
        if(!this.data){
            this.data={};
        }
        super.run();

        console.log("Colonize Op:" + this.name + " Romm: " + this.remoteRoomName);
        this.validateCreeps();
        //console.log("STep 1")
        this.enqueueCreeps();
        //console.log("Step 2")


        const r = this.remoteRoom;
        if(r != null){
            console.log("Remote Room");
            if(r.controller != null){
                console.log("Controller");
                if(r.controller.reservation != null){
                    console.log("Reservation");
                    console.log("ReservationName")
                    if(this.data.cancelCounter != null){
                        this.data.cancelCounter = this.data.cancelCounter +1;
                        console.log("Incrementing Cancel Counter: " +  this.name + " :" + this.data.cancelCounter);
                        if(this.data.cancelCounter > this.COLONIZE_TIMEOUT){
                            this.wrapUp(r);
                        }
                    } else {
                        console.log("Initializing cancelCounter");
                        this.data.cancelCounter = 0;
                    }
                } else {
                    if(r.controller.my ){
                        this.initialCleanup();
                        if(this.data.roomPlanner == null){
                            this.data.roomPlanner = this.manager.enque({type: OPERATION.ROOMPLANNER, data: {roomName: r.name, parent: this.name}, pause: 1});
                        }
                    } else {
                        if(!this.data.cancelCounter){
                            this.data.cancelCounter=0;
                        }
                        this.data.cancelCounter+=1;
                        console.log(" OP Name: " + this.name + " counter: " + this.data.cancelCounter);
                    }
                }

            }
            this.wrapUp(r);

        } 
        if(this.data.claim == null){
            const r = this.remoteRoom;
            if( r == null){
                this.checkClaimOperation();
            } else {
                if(r.controller != null){
                    if(r.controller.my !== true){
                        this.checkClaimOperation();
                    }
                }
            }
            
        }
        
        //console.log("Colonize end run");
    }

    private wrapUp(r: Room): void {
        if(r.storage != null && r.storage.my){
            this.manager.enque({type: OPERATION.BASE, data: {roomName: r.name},pause: 1});
            for(const creep of this.data.creeps){
                if(Game.creeps[creep] != null){
                    Game.creeps[creep].memory.role = "Maintenance";
                } else {
                    this.manager.empire.spawnMgr.dequeueByName(creep);
                }
            }
            RoomMemoryUtil.setOwner(r);
            this.removeSelf();
        }
        if(!Empire.canColonize()){
            this.removeSelf();
        }
        if(Game.time % 1000 === 0){
            if(RoomMemoryUtil.getDistance(this.room.name, this.remoteRoomName) > 10){
                this.removeSelf();
                for(const creep of this.data.creeps){
                    if(Game.creeps[creep] != null){
                        Game.creeps[creep].memory.role = "Maintenance";
                    } else {
                        this.manager.empire.spawnMgr.dequeueByName(creep);
                    }
                }
                RoomMemoryUtil.setOwner(r);
            }
        }
        if(this.data.parent != null){
            const parent = this.manager.getEntryByName(this.data.parent);
            if(parent == null){
                this.removeSelf();
                for(const creep of this.data.creeps){
                    if(Game.creeps[creep] != null){
                        Game.creeps[creep].memory.role = "Maintenance";
                    } else {
                        this.manager.empire.spawnMgr.dequeueByName(creep);
                    }
                }
                RoomMemoryUtil.setOwner(r);
            }
        }
        if(this.data.cancelCounter > this.COLONIZE_TIMEOUT){
            this.removeSelf();
            for(const creep of this.data.creeps){
                if(Game.creeps[creep] != null){
                    Game.creeps[creep].memory.role = "Maintenance";
                } else {
                    this.manager.empire.spawnMgr.dequeueByName(creep);
                }
            }
            RoomMemoryUtil.setOwner(this.data.room);
        }
    }

    private initialCleanup(): void {
        if(this.data.initialCleanup !== true){
            const r = Game.rooms[this.data.room];
            if(r != null){
                const structs = r.find(FIND_STRUCTURES);
                if( structs.length > 0){
                    for(const i of structs){
                        i.destroy();
                    }
                    this.data.initialCleanup = true;
                } 
            }
        }
    }

    private checkClaimOperation(): void {
        if(this.data.claim == null){
            //console.log("Create Claim op");
            this.createClaimOperation();
        } else {
            if(!Game.flags[this.data.claim]){
                this.data.claim = null;
            }
        }
    }
    private createClaimOperation(): void {
        //console.log("Create ClaimOperation");
        const flagName= this.name+"_CLAIM";
        let flag;
        Memory.flags[flagName]={};
        if(this.remoteRoom){
            this.remoteRoom.createFlag(25,25, flagName,COLOR_BLUE, COLOR_BLUE);
        } else {
            //console.log("Placing flag: " + this.room);
            this.room.createFlag(25,25, flagName,COLOR_BLUE, COLOR_BLUE);
            //console.log("Created Flag");

            //console.log("Setting flag memory");
            Memory.flags[flagName].moveTo = {x:25,y:25,roomName: this.remoteRoomName};
        }
        Memory.flags[flagName].parent=this.name;
        this.data.claim=flagName;
        
        //this.data.claim = this.manager.enque({type: OPERATION.CLAIM, data: {room: this.data.room, spawnRoom: this.data.spawnRoom, parent: this.name},pause: 1});
    }

    private enqueueCreeps(): void {
        if(!this.data){
            this.data={};
        }
        if(!this.data.creeps){
            this.data.creeps=[];
        }
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.data.spawnRoom;
            if(roomName != null){
                //console.log("STep 1.2");
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    //console.log("trying to spawn "+ i);
                    //console.log("flag: " + this.data.flag);
                    //console.log(" remoteRoom:" +this.data.room);
                    //console.log("this.room.name" + this.data.spawnRoom );
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Colonize",targetRoom: this.remoteRoomName, homeRoom: this.data.spawnRoom, op: this.name, flag: this.data.flag},
                        pause: 0,
                        priority: 20,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.removeSelf();
            }
        }
    }


}