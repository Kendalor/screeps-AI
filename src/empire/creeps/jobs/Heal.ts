import { Job } from "./Job";

export class Heal extends Job {

    
    public static run(creep: Creep): void {
        super.run(creep);
        const target: Creep | null = Game.getObjectById(creep.memory.targetId) as Creep;
        if(target != null){
            if(target.hits < target.hitsMax){
                const range = creep.pos.getRangeTo(target);
                if(range === 1){
                    creep.heal(target);
                }else if (range <= 3){
                    creep.rangedHeal(target);
                    creep.travelTo(target);
                } else {
                    creep.travelTo(target);
                    creep.heal(creep);
                }
            } else {
                this.cancel(creep);
                creep.heal(creep);
            }
        }else {
            this.cancel(creep);
        }

    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        const enemies = creep.room.find(FIND_MY_CREEPS).filter( c => c.hits<c.hitsMax);
        if( enemies.length > 0){
            const inRange = enemies.filter( e => e.pos.getRangeTo(creep) <= 3);
            if(inRange.length > 0){
                const mostDamaged = inRange.sort( (a,b) => a.hits-b.hits).shift();
                if(mostDamaged != null){
                    return mostDamaged.id;
                }
            } else {
                const mostDamaged = enemies.sort( (a,b) => a.hits-b.hits).shift();
                if(mostDamaged != null){
                    return mostDamaged.id;
                }
            }
        }
        return null;
    }
}