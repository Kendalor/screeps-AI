import { Job } from "./Job";


type PickupStructure = PickupStore | PickupEnergy;
type PickupStore = StructureContainer | StructureStorage | StructureTerminal | StructureNuker;
type PickupEnergy = StructureLink | StructureTower | StructureExtension;


export class PickupNearest extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: PickupStructure | null = Game.getObjectById(creep.memory.targetId);
        if( container != null){
            if( creep.carry.energy < creep.carryCapacity){
                if(container.store != null){
                    if(container.store.energy > 0){
                        if (creep.pos.inRangeTo(container,1)){
                            if(container.store.energy > 0 ){
                                creep.withdraw(container,RESOURCE_ENERGY);
                            } else {
                                this.cancel(creep);
                            }
                        }else{
                            creep.travelTo(container);
                        }
                    } else {
                        this.cancel(creep);
                    }
                }
            }else {
                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
    }


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity;
    }

    private static allowedStructure(str: Structure): boolean {
        if( str.structureType === STRUCTURE_CONTAINER  ||
            str.structureType === STRUCTURE_EXTENSION ||
            str.structureType === STRUCTURE_LINK ||
            str.structureType === STRUCTURE_STORAGE ||
            str.structureType === STRUCTURE_TERMINAL ||
            str.structureType === STRUCTURE_TOWER ||
            str.structureType === STRUCTURE_NUKER ) {
                return true;
            } else {
                return false;
            }
    }

    public static getTargetId(creep: Creep): string | null {
        let structures = creep.room.find(FIND_STRUCTURES).filter( str => PickupNearest.allowedStructure(str)) as PickupStructure[];
        structures = structures.filter( str => str.store.energy > 0);

        if(structures.length > 0 ){
            const nearest = creep.pos.findClosestByPath(structures);
            if(nearest != null){
                return nearest.id;
            }
        }
        return null;
    }
}