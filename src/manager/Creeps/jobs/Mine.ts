import { Harvest } from "./Harvest";

export class Mine extends Harvest {

    public static run(creep: Creep): void {
        super.run(creep);
        // SETUP HAS SOURCE ID, HAS CONTAINER ID
        if(creep.memory.containerId != null && creep.memory.pos_x == null && creep.memory.pos_x == null){
            const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
            if(container != null ){
                creep.memory.pos_x=container.pos.x;
                creep.memory.pos_y=container.pos.y;
            }
        }

        // IS HARVEST CREEP AND ENERGY NOT FULL and HAS SOURCE

        if(creep.carry.energy < creep.carryCapacity){
            // JOB EXECUTION
            global.logger.debug("Create Source from TargetID: " + creep.memory.targetId);
            const source: Source | null = Game.getObjectById(creep.memory.targetId);
            if( source !== null ){
                
                if(creep.inRangeTo(source,1)) {
                    if (source.energy){
                        creep.harvest(source);
                    }
                }else{
                    creep.moveTo(source, {ignoreCreeps: true});
                }
            } else {
                this.cancel(creep);
            }

        }
        // DROP IN CONTAINER, AND REPAIR LOGIC
        console.log("CReep:" + creep.name + "Starting CONTAINER DROP AND REPAIR LOGIC")
        global.logger.debug("CReep:" + creep.name + "Starting CONTAINER DROP AND REPAIR LOGIC");
        if(creep.carry.energy >= 40){
            global.logger.debug("CReep:" + creep.name + "GOt energy");
            if(creep.memory.pos_x != null && creep.memory.pos_y != null){
                global.logger.debug("CReep:" + creep.name + "Got COntainer Pos in Memory");
                if(creep.memory.containerId != null){
                    const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
                    global.logger.debug("CReep:" + creep.name + "Got COntainer Id in Memory");
                    if(container != null){
                        global.logger.debug("CReep:" + creep.name + "Container Exists");
                        if(creep.pos.x === creep.memory.pos_x && creep.pos.y === creep.memory.pos_y ){
                            global.logger.debug("CReep:" + creep.name + "Is standing on top of container");
                            if(container.hits <= container.hitsMax-100 ) {
                                global.logger.debug("CReep:" + creep.name + "Repair COntainer");
                                creep.repair(container);
                            } else {
                                global.logger.debug("CReep:" + creep.name + "DROP COntainer");
                                creep.drop(RESOURCE_ENERGY);
                            }
                        } else {
                            creep.moveTo(container);
                        }
                    } else {
                        delete creep.memory.containerId;
                    }
                }
            }
        }

        // CANCEL CONDITION
        if(creep.carry.energy === creep.carryCapacity){
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        console.log("Miner TargetId()");
        if( creep.memory.sourceId !== null || creep.memory.sourceId !== undefined ){
            console.log("Returning creep.memory.sourceId: " + creep.memory.sourceId);
            return creep.memory.sourceId;
            
        } else {
            return super.getTargetId(creep);
        }
    }
}