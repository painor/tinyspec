const _ = require('lodash');
const { parsePropsString } = require('./parseProps.js');

const DEFAULT_DEFINITION = '{}';

function toOpenapi(text, options) {
  const data = { definitions: {} };
  const models = data.definitions;
  const parents = [];

  const modelDefs = text
    .replace(/\s*#.*/gm, '')
    .replace(/[{(][\r\n]+(.|[\r\n])*?[\r\n]+[})](\[])?/gm, propsDef => propsDef.replace(/\s+/g, ' '))
    .split(/[\r\n]+/);

  let currentDescription = [];

  modelDefs.forEach((line) => {
    line = _.trim(line);

    if (!line.length) {
      return;
    }

    if (line.match(/\/\//)) {
      currentDescription.push(line.match(/\/\/\s*(.*)/)[1]);
      return;
    }

    const match = line.match(/^([A-Z]\w*)(\s*<\s*([A-Z]\w*))?\s*(.*)$/);

    if (!match) {
      throw new Error(`Invalid definition: \`${line}\``);
    }

    const modelName = match[1];
    const definition = match[4] || DEFAULT_DEFINITION;
    const isObject = /{.*}/.test(definition);
    const isEnum = /\(.*\)/.test(definition);

    if (!isObject && !isEnum) {
      throw new Error(`Invalid definition: \`${line}\``);
    }

    const modelSchema = {};

    if (currentDescription.length) {
      [modelSchema.title] = currentDescription;
      modelSchema.description = currentDescription.join('\n\n');
      currentDescription = [];
    }
    let isParent = false;
    if (isObject) {
      Object.assign(modelSchema, { type: 'object' }, parsePropsString(definition, options));

      const parentModelName = match[3];
      if (parentModelName) {
        isParent = true;
        // we want to parse these later because we might have not parsed the base models yet
        parents.push({
          parentModelName,
          modelName,
          modelSchema
        })
      }
    } else if (isEnum) {
      Object.assign(modelSchema, _.pick(parsePropsString(definition), ['enum']));
    }
    if (!isParent){
      models[modelName] = modelSchema;
    }
  });

  // we parse parents now after all base models are loaded
  for (const parent of parents){
    if (!models[parent.parentModelName] || !models[parent.parentModelName].properties) {
      throw new Error(`Parent model object not found for \`${parent.modelName} < ${parent.parentModelName}\``);
    }

    inherit(parent.modelSchema, models[parent.parentModelName]);
    models[parent.modelName] = parent.modelSchema;

  }
  return data;
}

function inherit(child, parent) {
  const selfFields = child.properties ? Object.keys(child.properties) : [];
  const removalIndicators = selfFields.filter(name => _.startsWith(name, '-'));
  const removedFields = removalIndicators.map(field => field.substring(1));
  const overriddenFields = _.difference(selfFields, removalIndicators);
  const inheritedFields = _.difference(
    Object.keys(parent.properties),
    [...overriddenFields, ...removedFields],
  );

  child.properties = _.assign(
    {},
    _.pick(parent.properties, inheritedFields),
    _.pick(child.properties, overriddenFields),
  );

  const selfRequired = child.required ? _.difference(child.required, removalIndicators) : [];
  const inheritedRequired = parent.required ? _.intersection(parent.required, inheritedFields) : [];

  if (selfRequired.length || inheritedRequired.length) {
    child.required = _.concat(
      inheritedRequired,
      selfRequired,
    );
  } else {
    delete child.required;
  }
}

module.exports = toOpenapi;
