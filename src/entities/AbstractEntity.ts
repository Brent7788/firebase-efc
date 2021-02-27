import {Guid} from "guid-typescript";
import DecoratorTool from "../tools/DecoratorTool";
import {ExpresionBuilder} from "../tools/ExpresionBuilder";

export default class AbstractEntity {

    private id: string | undefined;
    private createdDate = new Date();
    private fieldOrderNumber: number = -1;

    //TODO This ignoreId, create decorator for this
    constructor(ignoreIdGeneration = false, id: string | undefined = undefined) {

        if (id) {
            this.id = id;
        } else if (!ignoreIdGeneration) {
            this.id = Guid.create().toString();
        }
    }

    public asObject(): {} {
        let object = Object.assign({}, this);

        let ignoreValues = DecoratorTool.getMyPropertyDecoratorValues(this.constructor, "IgnoreField");

        for (const ignoreValue of ignoreValues) {
            // @ts-ignore
            delete object[ignoreValue];
        }

        let objectValues = DecoratorTool.getMyPropertyDecoratorValues(this.constructor, "ObjectField");

        for (const objectValue of objectValues) {
            // @ts-ignore
            object[objectValue] = object[objectValue].asObject();
        }

        return object;
    }

    public exp(): ExpresionBuilder {
        return new ExpresionBuilder();
    }

    get Id(): string | undefined {
        return this.id;
    }

    set Id(value: string | undefined) {
        this.id = value;
    }

    set CreatedDate(value: Date) {
        this.createdDate = value;
    }

    get FieldOrderNumber(): number {
        return this.fieldOrderNumber;
    }

    set FieldOrderNumber(value: number) {
        this.fieldOrderNumber = value;
    }
}
