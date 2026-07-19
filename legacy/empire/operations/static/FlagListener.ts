import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { InitialRoomOperation } from "../Operations/InitialBuildUpPhase/InitRoomOperation";

export class FlagListener extends Operation {



    constructor(name: string, manager: OperationsManager, entry: IOperationMemory) {
        super(name, manager,entry);
        this.type = OPERATION.FLAGLISTENER;
        
    }

    public run() {
        super.run();
        for(const key of Object.keys(Game.flags)) {
            const flag: Flag = Game.flags[key];
            if(flag.memory.op == null) {
                this.spawnOp(flag);
            }
        }
        this.cleanFlagMemory();
        this.removeSelf();
    }

    public spawnOp(flag: Flag){
        // Economic Ops
        if(flag.color === COLOR_GREEN) {
            switch(flag.secondaryColor){
                // COLONIZE
                case COLOR_RED:
                    this.enqueOp(OPERATION.COLONIZE_PORTAL,flag,5,3500);
                    break;
                case COLOR_GREEN:
                    this.enqueOp(OPERATION.MINE_POWER,flag,5,7500);
                    break;
                case COLOR_BLUE:
                    this.enqueOp(OPERATION.MINE_DEPOSIT,flag,4,5000);
                    break;

            }
        } else if (flag.color === COLOR_BLUE ){
            switch(flag.secondaryColor){
                // Remote POLITICS
                case COLOR_BLUE:
                    this.enqueOp(OPERATION.CLAIM,flag,7,750);
                    break;
                        
            }
        }
        
        
    }

    public cleanFlagMemory(){
        if(Memory.flags == null){
            Memory.flags = {};
        }
        for(const key of Object.keys(Memory.flags)){
            if(Game.flags[key] == null){
                delete Memory.flags[key];
            } else {
                const op = Memory.flags[key].op;
                if(!this.manager.entryExists(op)){
                    delete Memory.flags[key];
                }
            }
        }
    }

    public enqueOp(t: OPERATION, flag: Flag, maxDistance?: number, minEnergyAvailable?: number){
        const nearestOp= this.findnearestBaseOp(flag,maxDistance,minEnergyAvailable);
        if(nearestOp != null){
            flag.memory.op = nearestOp.enqueRemoteOp(t,flag.pos.roomName,flag);
            flag.memory.parent=nearestOp.name;
        } else {
            console.log("Could not find Fitting Room for Operation: " + t);
            flag.remove();
        }
    }

    public findnearestBaseOp(flag: Flag, maxDistance = 5, minEnergyAvailable=0 ): IInitialRoomOperation | undefined{
        const baseOps = this.manager.getBaseOperations().filter(op => op.room.energyCapacityAvailable >= minEnergyAvailable && Game.map.getRoomLinearDistance(op.room.name, flag.pos.roomName) <= maxDistance).sort( (a,b) => Game.map.getRoomLinearDistance(a.room.name,flag.pos.roomName) - Game.map.getRoomLinearDistance(b.room.name,flag.pos.roomName));
        console.log("Find nearest Room for Flag: " + flag.name + " In Room: " + flag.pos.roomName);
        console.log("In Order: " + JSON.stringify(baseOps.map(op => op.room.name)));
        return baseOps.shift();
    }

}