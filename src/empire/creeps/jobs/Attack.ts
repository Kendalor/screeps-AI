import { Job } from "./Job";

export class Attack extends Job {

    
    public static run(creep: Creep): void {
        super.run(creep);
        const target: Structure | null = Game.getObjectById(creep.memory.targetId) as Structure;
        if(target != null){
            if(creep.pos.inRangeTo(target,1)){
                creep.attack(target);
            } else {
                creep.travelTo(target);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        console.log("Attack Get Target");
        const enemies = creep.room.find(FIND_HOSTILE_CREEPS);
        console.log("FOund Enemies: " + JSON.stringify(enemies));
        if( enemies.length > 0){
            const e = creep.pos.findClosestByPath(enemies);
            if(e != null){
                return e.id;
            }

        }
        const structures= creep.room.find(FIND_HOSTILE_STRUCTURES);
        console.log("FOund Structures: " + JSON.stringify(structures));
        if(structures.length > 0){
            const s = creep.pos.findClosestByPath(structures);
            if(s != null){
                return s.id;
            }
        } 
        return null;
    }
}