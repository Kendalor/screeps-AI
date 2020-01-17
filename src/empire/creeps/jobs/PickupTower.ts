import { Job } from "./Job";

export class PickupTower extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureTower | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.pos.inRangeTo(container,1)){
                if(container.energy >= 200 ){
                    creep.withdraw(container,RESOURCE_ENERGY);
                } else {
                    this.cancel(creep);
                }
            }else{
                creep.travelTo(container, {ignoreCreeps: false});
            }
        // CANCEL CONDITION
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.targetId){
            return creep.memory.targetId;
        } else {
            const towers: StructureTower[] = creep.room.find(FIND_STRUCTURES).filter(
                (str) => str.structureType === STRUCTURE_TOWER && 
                str.energy > 0
            ) as StructureTower[];
            if ( towers.length > 0 && towers !== null ){
                const tower = creep.pos.findClosestByPath(towers);
                if(tower !== null && tower !== undefined ){
                    return tower.id;
                }
            }
        }
        return null;
    }
}