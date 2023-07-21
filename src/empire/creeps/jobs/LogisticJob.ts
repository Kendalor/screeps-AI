import { RoomLogisticsOperation } from "empire/operations/economy/RoomLogisticsOperation";
import { Job } from "./Job";

type STORE_STRUCTURE = StructureLink | StructureSpawn | StructureStorage | StructureTerminal | StructureTower;

export class LogisticJob extends Job {
    public static run(creep: Creep): void {
        if(creep.spawning){
            return;
        }
        super.run(creep);
        // RUN CODE
        const op = Empire.opMgr.getEntryByName<RoomLogisticsOperation>(creep.memory.op);
        // LINK LOGIC 
        if(op == null){
            return;
        }
        if(!this.isInCorrectPos(creep)){
            console.log("Move to correct POS");
            this.gotoCorrectPos(creep);
            return;
        }
        //console.log("Log Creep");
        const linkEnergy = op.getLinkNetworkEnergyLevel();
        const storageLink = op.getStorageLink();
        const controllerLink = op.getControllerLink();
        if(linkEnergy == null){
            return;
        }
        //console.log("Creep energy null ?");
        if(controllerLink != null && controllerLink.store.energy === 0){
            //console.log("Controller link no Energy");
            if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0){
                if( storageLink != null){
                    creep.transfer(storageLink, RESOURCE_ENERGY);
                }
            } else {
                if(creep.room.storage != null){
                    //console.log("Creep Room sotrage is != null");
                    const code =creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
                    //console.log("Return Code;");
                }
            }
        } else if(linkEnergy > 800) {
            if(creep.store.getUsedCapacity() > 0){
                if(creep.room.storage != null && creep.room.storage.store.energy < 800000){
                    creep.transfer(creep.room.storage, RESOURCE_ENERGY);
                } else if(creep.room.terminal != null  && creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0){
                    creep.transfer(creep.room.terminal, RESOURCE_ENERGY);
                } else {
                    if(creep.room.storage != null){
                        creep.transfer(creep.room.storage, RESOURCE_ENERGY);
                    }
                }
            } else {
                if( storageLink != null && storageLink.store.getUsedCapacity() !== 0){
                    creep.withdraw(storageLink, RESOURCE_ENERGY);
                } else {
                    if(creep.room.storage != null && creep.room.storage.store.energy > 80000){
                        creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
                    } else if( creep.room.terminal != null && creep.room.terminal.store.energy > 10000){
                        creep.withdraw(creep.room.terminal, RESOURCE_ENERGY);
                    }
                }
            }
        }

    }

    static gotoCorrectPos(creep: Creep): void {
        creep.moveTo(creep.room.memory.base!.anchor!.x, creep.room.memory.base!.anchor!.y);
    }
    static isInCorrectPos(creep: Creep): boolean {
        const pos = creep.pos;
        const defaultPos = creep.room.memory.base!.anchor!
        if( pos.x === defaultPos.x && pos.y === defaultPos.y){
            return true;
        }
        return false;
    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.link == null){
            const links = creep.room.lookForAt(LOOK_STRUCTURES,new RoomPosition(creep.pos.x, creep.pos.y-1, creep.pos.roomName)).filter(str => str.structureType === STRUCTURE_LINK);
            if(links != null){
                if(links.length > 0){
                    const link = links.pop() as StructureLink;
                    if(link != null){
                        creep.memory.link = link.id;
                    }
                }
            }
        }
        return "";
    }
}