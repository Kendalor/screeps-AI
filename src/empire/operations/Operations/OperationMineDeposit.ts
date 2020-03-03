import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, ROLE} from "utils/constants";
import { FlagOperation, FlagOperationData, FlagOperationProto } from "./FlagOperation";


export interface OperationMineDepositProto extends FlagOperationProto {
    data: OperationMineDepositData;
}

export interface OperationMineDepositData extends FlagOperationData {
    [id: string]: any;
    haulers: string[];
    harvesters: string[];
}


export class OperationMineDeposit extends FlagOperation {
    public numHarvesters = 1;
    public numHaulers = 1;
    public harvesters: string[];
    public haulers: string[];

    constructor(name: string, manager: OperationsManager, entry: OperationMineDepositProto) {
        super(name,manager,entry);
        this.type = OPERATION.MINE_DEPOSIT;
        this.haulers = this.data.haulers;
        this.harvesters =this.data.harvesters;
    }

    public run() {
        super.run();
        if(this.flag != null){
            console.log("Operation MineDeposit: " + this.data.roomName + " target: " + this.data.remoteRoom + " with Flag: " + this.flag.name);
            this.enqueueCreeps();
            const remote = Game.rooms[this.data.remoteRoom];
            if(remote != null){
                const deposit = remote.find(FIND_DEPOSITS).pop();
                if( deposit == null){
                    this.removeSelf();
                } else {
                    if(deposit.lastCooldown != null){
                        if(deposit.lastCooldown > 10){
                            this.removeSelf();
                        }
                    }
                }
            }

        }
    }
    public validateCreeps(): void {
        if(this.data.haulers != null){
            if(this.data.haulers.length > 0 ){
                for(const name of this.data.haulers){
                    if( Game.creeps[name] == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            _.remove(this.data.haulers, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.haulers = [];
        }

        if(this.data.harvesters != null){
            if(this.data.harvesters.length > 0 ){
                for(const name of this.data.harvesters){
                    if( Game.creeps[name] == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            _.remove(this.data.harvesters, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.harvesters = [];
        }
    }

    private enqueueCreeps(): void {
        this.validateCreeps();
        if(this.data.harvesters.length < this.numHarvesters){
            const b: BodyPartConstant[] = new Array(25).fill(MOVE).concat(new Array(25).fill(WORK));
            const name = this.manager.empire.spawnMgr.enque({
                body: b,
                room: this.room.name,
                memory: {role: "MineDeposit", targetRoom: this.data.remoteRoom,homeRoom: this.room.name, op: this.name},
                pause: 0,
                priority: 30,
                rebuild: false});
                this.data.harvesters.push(name);
        }
        if(this.data.haulers.length < this.numHaulers){
            const b: BodyPartConstant[] = new Array(25).fill(MOVE).concat(new Array(25).fill(CARRY));
            const name = this.manager.empire.spawnMgr.enque({
                body: b,
                room: this.room.name,
                memory: {role: "HaulDeposit", targetRoom: this.data.remoteRoom, homeRoom: this.room.name, op: this.name},
                pause: 0,
                priority: 29,
                rebuild: false});
            this.data.haulers.push(name);
        } 
    }


}