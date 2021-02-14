import {Guid} from "guid-typescript";
import DecoratorTool from "../tools/DecoratorTool";

export default class AbstractEntity {

    private _id: string | undefined;
    private _createdDate = new Date();

    //TODO This ignoreId, create decorator for this
    constructor(ignoreIdGeneration = false, id: string | undefined = undefined) {

        if (id) {
            this._id = id;
        } else if (!ignoreIdGeneration) {
            this._id = Guid.create().toString();
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

    get id(): string | undefined {
        return this._id;
    }

    set id(value: string | undefined) {
        this._id = value;
    }

    set createdDate(value: Date) {
        this._createdDate = value;
    }
}
