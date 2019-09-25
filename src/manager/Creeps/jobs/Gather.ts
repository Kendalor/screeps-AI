import { Job } from "./Job";


export class Gather extends Job {

    public static run(creep: Creep): void {


        // RUN CODE
        const container: StructureContainer | StructureStorage | StructureTerminal | null = Game.getObjectById(creep.memory.containerId);
        if(creep.memory.job === 'Gather' && container != null && creep.carry.energy < creep.carryCapacity){
            const salvage = creep.room.find(FIND_DROPPED_RESOURCES).filter( (s: Resource ) => container.pos.x === s.pos.x && container.pos.y === s.pos.y && creep.room.name === s.room!.name)[0];
            if (salvage !== undefined){
                if (creep.inRangeTo(salvage,1)){
                    creep.pickup(salvage);
                }else{
                    creep.moveTo(salvage);
                } 
            }else if (creep.inRangeTo(container,1)){
                if(container.store.energy >= creep.carryCapacity-creep.carry.energy || container.store.energy >= 1000){
                    creep.withdraw(container,RESOURCE_ENERGY);
                }
            }else{
                if(creep.memory.role !== 'Upgrader'){
                    creep.moveTo(container);
                }else{
                    creep.moveTo(container);
                }
            }
        }

        // CANCEL CONDITION
        if(creep.carry.energy === creep.carryCapacity){
            this.cancel(creep);
        }

    }


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity && this.getTargetId(creep) !== null;
    }


    // GET Object id of Target if applicable or return null
    // Applicable targets in preferable Order: Storage, Container, Source
    public static getTargetId(creep: Creep): string | null {
        let targetId: string | null = null;
        // GET FROM TERMINAL
        if (creep.room.terminal ) {
            if ( creep.room.terminal.store.energy > 51000 ){
                targetId = creep.room.terminal.id;
            }
        // GET FROM STORAGE
        }else if (targetId === null && creep.room.storage ) {
            if ( creep.room.storage.store.energy > creep.carryCapacity ){
                targetId = creep.room.storage.id;
            }
        // GET FROM CONTAINER
        } else if (targetId === null && creep.room.find(FIND_STRUCTURES).filter( (struct) => struct.structureType === STRUCTURE_CONTAINER).length > 0) {
            const containers = creep.room.find(FIND_STRUCTURES).filter( (struct) => struct.structureType === STRUCTURE_CONTAINER);
            const target = creep.pos.findClosestByPath(containers);
            if ( target ) {
                targetId = target.id;
            }
        // GET FROM SOURCE    
        } else if (targetId === null) {
            const sources = creep.room.find(FIND_SOURCES); 
            const source = creep.pos.findClosestByPath(sources);
            // Found Harvest Target ?
            if (source !== null) {
                targetId = source.id
            } 
        }

        // RETURN
        if(targetId !== null ){
            return targetId;
        } else {
            return null
        }

    }
}