import { RoomLogisticsOperation } from "empire/operations/Operations/RoomLogisticsOperation";
import { Job } from "./Job";

type STORE_STRUCTURE = StructureLink | StructureSpawn | StructureStorage | StructureTerminal | StructureTower;

export class LogisticJob extends Job {
    public static run(creep: Creep): void {
        if(!creep.spawning){
            super.run(creep);
            // RUN CODE
            const op =global.empire.opMgr.getEntryByName<RoomLogisticsOperation>(creep.memory.op);
            // LINK LOGIC 
            if(op != null){
                const linkEnergy = op.getLinkNetworkEnergyLevel();
                const storageLink = op.getStorageLink();
                const controllerLink = op.getControllerLink();
                if(linkEnergy != null){
                    if(controllerLink != null && controllerLink.store.energy === 0){
                        if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0){
                            if( storageLink != null){
                                creep.transfer(storageLink, RESOURCE_ENERGY);
                            }
                        } else {
                            if(creep.room.storage != null){
                                creep.withdraw(creep.room.storage, RESOURCE_ENERGY);
                            }
                        }
                    } else if(linkEnergy > 800) {
                        if(creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0){
                            if(creep.room.storage != null){
                                creep.transfer(creep.room.storage, RESOURCE_ENERGY);
                            }
                        } else {
                            if( storageLink != null){
                                creep.withdraw(storageLink, RESOURCE_ENERGY);
                            }
                        }
                    }
                }
            }

        }

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