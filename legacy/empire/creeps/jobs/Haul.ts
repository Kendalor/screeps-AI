import { Job } from "./Job";

type HaulTargetwithStore = StructureStorage | StructureTerminal;
type HaulTargetwithEnergy = StructureContainer | StructureTower | StructureSpawn | StructureExtension | StructureLink;
type  HaulTarget = null | HaulTargetwithStore | HaulTargetwithEnergy;

export class Haul extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target: HaulTarget = <HaulTarget>Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else if (target.structureType === STRUCTURE_CONTAINER || target.structureType === STRUCTURE_STORAGE || target.structureType === STRUCTURE_TERMINAL) {
            // TARGET FULL
            if (target.store.energy === target.storeCapacity) {
                this.cancel(creep);
            }
        // TARGET IS SPAWN/LINK/TOWER
        } else if( target.structureType === STRUCTURE_LINK || target.structureType === STRUCTURE_SPAWN || target.structureType === STRUCTURE_TOWER || target.structureType === STRUCTURE_EXTENSION ){
            // TARGET FULL
            if(target.energy === target.energyCapacity) {
                this.cancel(creep);
            }
        } 
        if (creep.carry.energy > 0){
            // JOB EXECUTION
            if(target !== null){
                if ( creep.pos.inRangeTo(target,1)){
                    creep.transfer(target, RESOURCE_ENERGY);
                }else{
                    creep.travelTo(target);
                }
            } else {
                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
        
    }
    

    public static runCondition(creep: Creep): boolean {
        if(creep.carry.energy > 0 ){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        // FIND TARGET CODE
        let targets: any[] = [];
        const structures = creep.room.find(FIND_MY_STRUCTURES);
        // TOWERS
        if (!targets.length){
            const tmpList: StructureTower[] = structures.filter((str) => str.structureType === STRUCTURE_TOWER) as StructureTower[];
            targets = tmpList.filter((structure) => structure.energy < structure.energyCapacity-800);
        }

        // EXTENSIONS
        if(!targets.length){
            const tmpList: StructureExtension[] = structures.filter((str) => str.structureType === STRUCTURE_EXTENSION) as StructureExtension[];
            targets = tmpList.filter((structure) => structure.energy < structure.energyCapacity);
        }
        // SPAWNS
        if (!targets.length){
            const tmpList: StructureSpawn[] = structures.filter((str) => str.structureType === STRUCTURE_SPAWN) as StructureSpawn[];
            targets = tmpList.filter((structure) => structure.energy < structure.energyCapacity);
        }



        // TERMINAL
        if (!targets.length && creep.room.terminal && creep.room.terminal.store.energy<50000){
            targets = [creep.room.terminal];
        }

        // LABS
        if (!targets.length && creep.room.labs.length){
            const tmpList: StructureLab[] = structures.filter((str) => str.structureType === STRUCTURE_LAB) as StructureLab[];
            targets = tmpList.filter((structure) => structure.energy < 1000);
        }

        // POWERSPAWN
        if (!targets.length && creep.room.powerSpawn && creep.room.powerSpawn.energy<creep.room.powerSpawn.energyCapacity){
            targets = [creep.room.powerSpawn];
        }

        // NUKER
        if (!targets.length && creep.room.nuker && creep.room.nuker!.energy < creep.room.nuker!.energyCapacity){
            targets = [creep.room.nuker];
        }

        // TOWERS
        if (!targets.length && creep.carry.energy > 0 ){// creep.carryCapacity/4){
            const tmpList: StructureTower[] = structures.filter((str) => str.structureType === STRUCTURE_TOWER) as StructureTower[];
            targets = tmpList.filter((structure) => structure.energy < structure.energyCapacity-100);
        }

        // STORAGE
        if (!targets.length && creep.carry.energy > 0 ){
            targets = [creep.room.storage].filter( (structure) => structure && structure.store.energy < structure.storeCapacity && creep.room.name === structure.room.name);
        }
        // TARGETS FOUND
        if (targets.length){
            const newtarget = creep.pos.findClosestByPath(targets);
            if (newtarget !== undefined){
                return newtarget!.id;
            }
        }
        return null;
    }   

}