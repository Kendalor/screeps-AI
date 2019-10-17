import { Mine } from "./Mine";

export class MineContainer extends Mine {

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

        // SUPER CALL Mine Code
        // IS HARVEST CREEP AND ENERGY NOT FULL and HAS SOURCE
        super.run(creep);

        // DROP IN CONTAINER, AND REPAIR LOGIC
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
        if(super.runCondition(creep)) {
            if(creep.memory.containerId != null){
                const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
                if(container != null){
                    return true;
                }
            }
        }
        return false;

    }

    public static getTargetId(creep: Creep): string | null {
        return super.getTargetId(creep);
    }
}