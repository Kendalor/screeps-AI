import { MineLink } from "./MineLink";

export class MineLinkMulti extends MineLink {

    public static run(creep: Creep): void {
        const source = Game.getObjectById<Source>(creep.memory.targetId);
        if(source != null) {
            if(source.energy){
                super.run(creep);
            } else {
                const newTargetId = this.getTargetId(creep);
                if(newTargetId != null){
                    const otherSource = Game.getObjectById<Source>(newTargetId);
                    if(otherSource != null){
                        if(otherSource.energy){
                            this.cancel(creep);
                        } else {
                            creep.travelTo(otherSource);
                        }
                    }
                }
                

                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.memory.sourceId.length > 1){
            return super.runCondition(creep);
        }
        return false;

    }

    public static cancel(creep: Creep): void {
        delete creep.memory.linkId;
        super.cancel(creep);
    }

    public static getTargetId(creep: Creep): string | null {
        if( creep.memory.sourceId != null  ){
            if(creep.memory.sourceId.length === 1){
                return super.getTargetId(creep);  
            } else {
                const sources = [];
                for(const c of creep.memory.sourceId){
                    const source = Game.getObjectById<Source>(c);
                    if(source != null){
                        sources.push(source);
                        if(source.energy){
                            return source.id;
                        }
                    }
                }
                if(sources.length === 2){
                    let min = sources[0];
                    if( sources[1].ticksToRegeneration < min.ticksToRegeneration){
                        min = sources[1];
                    }
                    return min.id;
                }
            }
             
        }
        return null;
    }
    
}