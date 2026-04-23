import { Box3, Group } from "three";

import Generic from "./Generic";

export default class Train extends Generic {
  withSize = (size = 2) => {
    const _train = new Group();

    const front = this.getNode("front");
    _train.add(front);

    const box = new Box3();
    box.setFromObject(front);
    let offset = box.max.x;

    for (let i = 0; i < size; i++) {
      const middle = this.getNode("middle");
      _train.add(middle);

      box.setFromObject(middle);
      middle.position.x = offset - box.min.x;

      box.setFromObject(middle);
      offset = box.max.x;
    }
    const back = this.getNode("back");
    _train.add(back);

    box.setFromObject(back);
    back.position.x = offset - box.min.x;

    return _train;
  };

  setup = async () => {
    const {
      vehicles: { train },
    } = this.globalModels;

    await this._register("front", {
      ...train[`front`],
      receiveShadow: true,
      castShadow: true,
    });
    await this._register("middle", {
      ...train[`middle`],
      receiveShadow: true,
      castShadow: true,
    });
    await this._register("back", {
      ...train[`back`],
      receiveShadow: true,
      castShadow: true,
    });

    return this.models;
  };
}
