import { OperationsManager } from "empire/OperationsManager";
import { OPERATION} from "utils/constants";
import { FlagOperation, FlagOperationData, FlagOperationProto } from "./FlagOperation";
import { RemoteOperation, RemoteOperationData } from "./RemoteOperation";
import { CreepRole } from "empire/creeps/roles/CreepRole";

export interface OperationMinePowerProto extends FlagOperationProto {
    data: OperationMinePowerData;
}

export interface OperationMinePowerData extends FlagOperationData {
    [id: string]: any;
    attackers: string[];
    hauler: string[];
    healers: string[];
}


export class OperationMinePower extends FlagOperation {

    constructor(name: string, manager: OperationsManager, entry: OperationMinePowerProto) {
        super(name,manager,entry);
        this.type = OPERATION.MINE_POWER;
    }

    public run() {
        super.run();
        if(this.flag != null){
            console.log("Operation MinePower: " + this.data.roomName + " target: " + this.data.remoteRoom + " with Flag: " + this.flag.name);
            const remote = Game.rooms[this.data.remoteRoom];
            this.data.numAttackers =1;
            this.data.numHealers=2;
            this.data.numHeaulers=0;
            if(remote != null){
                const powerBank = remote.find(FIND_STRUCTURES).filter(str => str.structureType === STRUCTURE_POWER_BANK).pop() as StructurePowerBank | undefined;
                if(powerBank == null){
                    this.data.numAttackers =0;
                    this.data.numHealers=0;
                    this.data.numHaulers=1;
                    this.removeSelf();
                } else {
                    const avgDMG = 1200;
                    const timeLeft = Math.ceil(powerBank.hits/avgDMG);
                    if(timeLeft > powerBank.ticksToDecay){
                        // TODO
                        console.log("OP Powerbank will not Finish " + timeLeft);

                    } else {
                        if(timeLeft < 200){
                            this.data.numHaulers=1;
                        }
                    }

                }
            }
        }
        this.enqueueCreeps();
        

        


    }

    public validateCreeps(): void {
        if(this.data.attackers != null){
            if(this.data.attackers.length > 0 ){
                console.log("Attacker length: " + this.data.attackers.length);
                for(const name of this.data.attackers){
                    const creep =Game.creeps[name];
                    if( creep == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            _.remove(this.data.attackers, (e) => e === name);
                        }
                    } else {
                        if(creep.ticksToLive != null && creep.ticksToLive< 250){
                            _.remove(this.data.attackers, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.attackers = [];
        }

        if(this.data.healers != null){
            if(this.data.healers.length > 0 ){
                console.log("Healers length: " + this.data.healers.length);
                for(const name of this.data.healers ){
                    const creep =Game.creeps[name];
                    if( creep == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            _.remove(this.data.healers, (e) => e === name);
                        }
                    } else {
                        if(creep.ticksToLive != null && creep.ticksToLive< 250){
                            _.remove(this.data.healers, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.healers  = [];
        }

        if(this.data.haulers != null){
            if(this.data.haulers.length > 0 ){
                console.log("Attacker length: " + this.data.haulers.length);
                for(const name of this.data.haulers){
                    const creep =Game.creeps[name];
                    if( creep == null){
                        if(!this.manager.empire.spawnMgr.containsEntry(name)) {
                            _.remove(this.data.haulers, (e) => e === name);
                        }
                    } else {
                        if(creep.ticksToLive != null && creep.ticksToLive< 200){
                            _.remove(this.data.haulers, (e) => e === name);
                        }
                    }
                }
            }
        } else {
            this.data.haulers = [];
        }
    }

    private enqueueCreeps(): void {
        this.validateCreeps();
        if(this.data.attackers.length < this.data.numAttackers){
            const b: BodyPartConstant[] = new Array(25).fill(ATTACK).concat(new Array(25).fill(MOVE));
            const name = this.manager.empire.spawnMgr.enque({
                body: b,
                room: this.room.name,
                memory: {role: "Attacker", targetRoom: this.data.remoteRoom,homeRoom: this.room.name, op: this.name},
                pause: 0,
                priority: 30,
                rebuild: false});
                this.data.attackers.push(name);
        }
        if(this.data.healers.length < this.data.numHealers){
            const b: BodyPartConstant[] = new Array(16).fill(HEAL).concat(new Array(16).fill(MOVE));
            const name = this.manager.empire.spawnMgr.enque({
                body: b,
                room: this.room.name,
                memory: {role: "Healer", targetRoom: this.data.remoteRoom, homeRoom: this.room.name, op: this.name},
                pause: 0,
                priority: 29,
                rebuild: false});
            this.data.healers.push(name);
        }
        if(this.data.haulers.length < this.data.numHaulers){
            const b: BodyPartConstant[] = new Array(25).fill(CARRY).concat(new Array(25).fill(MOVE));
            const name = this.manager.empire.spawnMgr.enque({
                body: b,
                room: this.room.name,
                memory: {role: "HaulDeposit", targetRoom: this.data.remoteRoom,homeRoom: this.room.name, op: this.name},
                pause: 0,
                priority: 30,
                rebuild: false});
                this.data.haulers.push(name);
        } 
    }


}