export class Job {

    public static run(creep: Creep): void {
        // TODO
    }

    public static  cancel(creep: Creep): void {
        creep.memory.targetId = undefined;
        creep.memory.job = undefined;
    }

    public static runCondition(creep: Creep): boolean {
        // TODO
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        // TODO
        return null;
    }
}