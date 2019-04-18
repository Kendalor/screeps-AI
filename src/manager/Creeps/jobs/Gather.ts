import { Job } from "./Job";

export class Gather extends Job {

    public static run(creep: Creep): void {
        // GET TARGETID CODE
        if (!creep.memory.containerId){
            if (creep.memory.role === 'Hauler' && !creep.memory.containerId) {
                
                const pos = creep.room.memory.sources[creep.memory.source].containerPos;
                const containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType === STRUCTURE_CONTAINER);
                creep.memory.containerId = containers.filter((struct: Structure) => struct.pos.x === pos.x && struct.pos.y === pos.y)[0];
            }else{
                let noHaulContainer: Structure | null = null;
                if (creep.room.controller!.level<8 && creep.room.terminal && creep.room.terminal.store.energy > 51000){
                    noHaulContainer = creep.room.terminal;
                } 
                if (!noHaulContainer && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > creep.carryCapacity){
                    noHaulContainer = creep.room.storage;
                } 
                if (!noHaulContainer && creep.memory.role !== 'Upgrader') {
                    noHaulContainer = creep.pos.findClosestByPath(creep.room.containers, {filter: (s: StructureContainer) => s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name === s.room.name})
                }
                if (noHaulContainer){
                    creep.memory.containerId = noHaulContainer.id;
                }
            }
        } 
        
        
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
        if(creep.memory.job === 'Gather' && (creep.carry.energy === creep.carryCapacity || creep.memory.containerId === null || container === null || container.store[RESOURCE_ENERGY] < creep.carryCapacity/4)){
            if (creep.memory.role !== 'Hauler'){
                delete creep.memory.containerId;
            }
            this.cancel(creep);
        }

    }


    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity && this.getTargetId(creep) !== null;
    }

    public static getTargetId(creep: Creep): string | null {
        if (!creep.memory.containerId){
            // GET FROM SOURCE CONTAINER
            if (!creep.memory.containerId) {
                // SET SORUCE CONTAINER ID INTO MEMORY
                const pos = creep.room.memory.sources[creep.memory.source].containerPos;
                const containers = creep.room.lookForAt('structure',pos.x,pos.y).filter((struct) => struct.structureType === STRUCTURE_CONTAINER);
                creep.memory.containerId = containers.filter((struct: Structure) => struct.pos.x === pos.x && struct.pos.y === pos.y)[0];

            } else {
            // GET FROM OTHER CONTAINER
                let noHaulContainer: Structure | null = null;
                // SUB LVL 8 AND TERMINAL AND STORAGE (GET FORM TERMINAL)
                if (creep.room.controller!.level<8 && creep.room.terminal && creep.room.terminal.store.energy > 51000){
                    noHaulContainer = creep.room.terminal;
                } 
                // GET FROM STORAGE
                if (!noHaulContainer && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > creep.carryCapacity){
                    noHaulContainer = creep.room.storage;
                } 
                // GET FROM CLOSEST CONTAINER WITH ENOUGH ENERGY
                if (!noHaulContainer && creep.memory.role !== 'Upgrader') {
                    noHaulContainer = creep.pos.findClosestByPath(creep.room.containers, {filter: (s: StructureContainer) => s.store[RESOURCE_ENERGY] > creep.carryCapacity && creep.room.name === s.room.name})
                }
                // CONTAINER FOUND
                if (noHaulContainer){
                    return noHaulContainer.id;
                }
                
            }
        }
        return null; 
    }
}