export const serializePermission = (permisson: []) => {
  const newPermissionData = [];
  if (permisson.length < 1) {
    return;
  }

  const checkIndex = (i: number) => {
    if (i === 0) {
      return 'creator';
    } else if (i === 1) {
      return 'brand';
    } else if (i === 2) {
      return 'campaign';
    }
  };

  for (const i in permisson) {
    const data = {
      resources: checkIndex(parseInt(i)),
      actions: permisson[i]['actions'],
    };

    newPermissionData.push(data);
  }

  return newPermissionData;
};
