

export interface OperationMemory {
    data: any;
    type: OPERATION;
    priority: number;
    pause: number;
    parent?: string;
}