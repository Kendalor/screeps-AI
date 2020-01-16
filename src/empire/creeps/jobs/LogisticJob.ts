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
                console.log("Logistic Creep: " + creep.room.name);
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
                        console.log("Logistic Creep: " + creep.room.name + " linkEnergy > 800");
                        if(creep.store.getUsedCapacity() > 0){
                            console.log("Logistic Creep: " + creep.room.name + " creep energy !=0");
                            if(creep.room.storage != null && creep.room.storage.store.energy < 800000){
                                console.log("Logistic Creep: " + creep.room.name + " creep storage");
                                creep.transfer(creep.room.storage, RESOURCE_ENERGY);
                            } else if(creep.room.terminal != null  && creep.room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0){
                                console.log("Logistic Creep: " + creep.room.name + " creep terminal");
                                creep.transfer(creep.room.terminal, RESOURCE_ENERGY);
                            } else {
                                if(creep.room.storage != null){
                                    console.log("Logistic Creep: " + creep.room.name + " creep storage2");
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