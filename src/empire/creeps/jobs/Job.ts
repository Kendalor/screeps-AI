export class Job {

    public static run(creep: Creep): void {
        global.logger.debug("Creep: " + creep.name + " Run Function: ");
    }

    public static  cancel(creep: Creep): void {
        creep.memory.targetId = undefined;
        creep.memory.job = undefined;
    }

    public static runCondition(creep: Creep): boolean {
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        return null;
    }
}